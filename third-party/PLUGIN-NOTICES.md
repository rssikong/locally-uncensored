# Plugin notices

Plugins are third-party programs LU starts on the user's computer when the
user switches them on. They are not bundled with LU: LU fetches the pinned
official package on first use and checks it against the checksum the
registry publishes. Their own notices travel inside those packages.

## REA, Reverse Engineer Anything: rea-agents 6.5.0 (MIT)

Source: https://github.com/morluto/rea, npm package `rea-agents` 6.5.0,
integrity sha512-C6BG7LyrAdR74mSjertM6PrxJkcNZ2bfQNOJornPo9erDEp2tyPRVYPnV5Yodr+1RqewCQla68WulXlVnveD+A==.
Its dependencies and separately obtained engines are listed in the
THIRD_PARTY_NOTICES.md inside that package. REA's license grants no rights to
proprietary analysis tools it can drive (Ghidra, Hopper, JADX, Frida); LU
installs none of them. REA's DISCLAIMER.md asks for lawful use on software the
user owns or is authorized to examine.

MIT License

Copyright (c) 2026 morluto

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
