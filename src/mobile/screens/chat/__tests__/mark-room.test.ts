/**
 * Short check on the iPhone, package 8, B1: the mark of a new chat went by
 * the text size, not by the room. The numbers of the report: the largest
 * text on an iPhone 17, three lines of greeting, 195 points free above and
 * below.
 *
 * Run: npx vitest run src/mobile/screens/chat/__tests__/mark-room.test.ts
 */
import { describe, expect, it } from 'vitest'
import { greetingRoom, MARK_PX, markFits } from '../parts/mark-room'

describe('markFits', () => {
  it('the case of the report: 390 points free around the greeting, the mark fits', () => {
    const greeting = 240
    expect(markFits(greeting, false, 4, greeting + 195 + 195)).toBe(true)
  })

  it('a strip between the notice lines and the composer: the heading keeps the room', () => {
    expect(markFits(120, false, 4, 150)).toBe(false)
    expect(markFits(120, false, 4, 120 + MARK_PX + 3)).toBe(false)
    expect(markFits(120, false, 4, 120 + MARK_PX + 4)).toBe(true)
  })

  it('says the same with the mark on screen as without it, so it never flickers', () => {
    for (const room of [100, 179, 180, 181, 400]) {
      const without = 120
      const withMark = without + MARK_PX + 4
      expect(markFits(withMark, true, 4, room)).toBe(markFits(without, false, 4, room))
    }
  })

  it('nothing measured yet means no', () => {
    expect(markFits(0, false, 4, 400)).toBe(false)
    expect(markFits(120, false, 4, 0)).toBe(false)
  })
})

// Check Android package 17, A1: "Ask LU anything" half under the composer. What fits whole is shown, the rest not.
describe('the words of the greeting follow the room', () => {
  it('all, only the heading, or nothing', () => {
    expect(greetingRoom(80, 40, 120)).toBe('all')
    expect(greetingRoom(80, 40, 60)).toBe('title')
    expect(greetingRoom(80, 40, 36)).toBe('none')
    expect(greetingRoom(80, 40, 39.6)).toBe('title')
    expect(greetingRoom(80, 40, 0)).toBe('all')
  })
})
