//! The Wi-Fi address a phone should use to reach this computer.
//!
//! `local_ip_address::local_ip()` returns the FIRST non-loopback IPv4 on
//! macOS and Linux, in whatever order the system lists its interfaces. On a
//! Mac with LogMeIn Hamachi that is the Hamachi adapter (25.x.x.x), which no
//! phone on the Wi-Fi can reach: the QR code and the address under it pointed
//! nowhere and the phone app reported that it could not find the computer.
//!
//! The address that matters is the one the computer itself uses on its
//! default route. A UDP socket that is "connected" to a public address picks
//! exactly that source address from the routing table, without sending a
//! packet. VPN and virtual adapters (Hamachi, Tailscale, ZeroTier, WireGuard,
//! VirtualBox, VMware, Docker, Parallels) only win when nothing else exists.

use std::net::{IpAddr, Ipv4Addr, UdpSocket};

/// Source address of the default route, if there is one.
fn default_route_source() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind(("0.0.0.0", 0)).ok()?;
    // No packet leaves the machine: connect() on UDP only asks the routing
    // table which local address would be used.
    socket.connect(("1.1.1.1", 80)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_unspecified() && !ip.is_loopback() => Some(ip),
        _ => None,
    }
}

const VIRTUAL_NAME_PARTS: &[&str] = &[
    "hamachi", "tailscale", "zerotier", "zt", "utun", "tun", "tap", "wg", "wireguard", "ppp", "ipsec",
    "vbox", "virtualbox", "vmnet", "vmware", "docker", "br-", "bridge", "veth", "virbr", "vnic", "parallels",
    "llw", "awdl", "anpi", "gif", "stf", "ham",
];

fn looks_virtual(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    VIRTUAL_NAME_PARTS.iter().any(|p| n.starts_with(p) || n.contains(&format!("{p} ")) || n.contains(p) && p.len() > 3)
}

/// Lower is better.
fn rank(ip: Ipv4Addr, name: &str, default_source: Option<Ipv4Addr>) -> u8 {
    let o = ip.octets();
    if ip.is_loopback() || ip.is_unspecified() {
        return 255;
    }
    if ip.is_link_local() {
        return 200;
    }
    let virt = looks_virtual(name);
    // 25.0.0.0/8 is Hamachi's range, 100.64.0.0/10 is CGNAT (Tailscale, mobile carriers).
    let vpn_range = o[0] == 25 || (o[0] == 100 && (64..=127).contains(&o[1]));
    let private = ip.is_private();
    let is_default = default_source == Some(ip);
    match (is_default, private, virt || vpn_range) {
        (true, true, false) => 0,
        (false, true, false) => 10,
        (true, false, false) => 20,
        (true, _, true) => 40,
        (false, false, false) => 50,
        (false, true, true) => 60,
        (false, false, true) => 70,
    }
}

/// Pure choice, for tests: interfaces as (name, ip) pairs in system order.
pub(crate) fn choose(interfaces: &[(String, IpAddr)], default_source: Option<Ipv4Addr>) -> Option<Ipv4Addr> {
    interfaces
        .iter()
        .filter_map(|(name, ip)| match ip {
            IpAddr::V4(v4) => Some((rank(*v4, name, default_source), *v4)),
            IpAddr::V6(_) => None,
        })
        .filter(|(r, _)| *r < 255)
        .min_by_key(|(r, _)| *r)
        .map(|(_, ip)| ip)
        .or(default_source)
}

/// Best Wi-Fi/LAN address of this computer for a phone, as a string.
/// Falls back to `local_ip()` and finally to 127.0.0.1, like the old code.
pub fn lan_address() -> String {
    let default_source = default_route_source();
    let interfaces = local_ip_address::list_afinet_netifas().unwrap_or_default();
    choose(&interfaces, default_source)
        .map(|ip| ip.to_string())
        .or_else(|| local_ip_address::local_ip().ok().map(|ip| ip.to_string()))
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

/// Same as [`lan_address`], but `None` when nothing better than loopback exists.
pub fn lan_ip() -> Option<IpAddr> {
    let s = lan_address();
    s.parse::<IpAddr>().ok().filter(|ip| !ip.is_loopback())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ifs(list: &[(&str, &str)]) -> Vec<(String, IpAddr)> {
        list.iter().map(|(n, ip)| (n.to_string(), ip.parse().unwrap())).collect()
    }

    #[test]
    fn hamachi_listed_first_does_not_win_on_a_mac() {
        // Davids Mac, 20.10.2026: en7 (Hamachi) comes before en0 in getifaddrs.
        let list = ifs(&[("lo0", "127.0.0.1"), ("en7", "25.31.185.216"), ("en0", "192.168.1.50")]);
        assert_eq!(choose(&list, Some("192.168.1.50".parse().unwrap())), Some("192.168.1.50".parse().unwrap()));
        // Even without a default route answer, the private Wi-Fi address wins.
        assert_eq!(choose(&list, None), Some("192.168.1.50".parse().unwrap()));
    }

    #[test]
    fn windows_box_with_virtualbox_tailscale_and_link_local() {
        let list = ifs(&[
            ("Ethernet 2", "192.168.56.1"),
            ("LAN-Verbindung* 11", "169.254.115.165"),
            ("WLAN", "192.168.0.74"),
            ("Tailscale", "100.105.153.30"),
        ]);
        assert_eq!(choose(&list, Some("192.168.0.74".parse().unwrap())), Some("192.168.0.74".parse().unwrap()));
    }

    #[test]
    fn tailscale_cgnat_and_docker_lose_to_the_lan() {
        let list = ifs(&[("tailscale0", "100.101.1.2"), ("docker0", "172.17.0.1"), ("wlan0", "10.0.0.23")]);
        assert_eq!(choose(&list, None), Some("10.0.0.23".parse().unwrap()));
    }

    #[test]
    fn a_vpn_that_owns_the_default_route_still_beats_nothing() {
        let list = ifs(&[("utun4", "10.8.0.6")]);
        assert_eq!(choose(&list, Some("10.8.0.6".parse().unwrap())), Some("10.8.0.6".parse().unwrap()));
    }

    #[test]
    fn only_loopback_gives_none() {
        let list = ifs(&[("lo0", "127.0.0.1")]);
        assert_eq!(choose(&list, None), None);
    }

    #[test]
    fn lan_address_is_never_empty() {
        let a = lan_address();
        eprintln!("lan_address on this machine: {a}");
        assert!(!a.is_empty());
    }
}
