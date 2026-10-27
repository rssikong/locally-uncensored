/**
 * How a prompt names the images of a multi-image edit (Discord help-18,
 * 23.10.2026: "should i just put image 2, or IMAGE 2.? is it case or space
 * sensitive?"). Every spelling of an image that is there becomes the label
 * the encoder puts in front of it; everything else stays as typed.
 *
 * Run: npx vitest run src/lib/__tests__/image-ref-names.test.ts
 */
import { describe, expect, it } from 'vitest'
import { canonicalImageRef, canonicalImageRefs, imageRefWords, withImageRef } from '../image-ref-names'

const q21 = (prompt: string, count = 3) => canonicalImageRefs(prompt, count, 'qwen21')
const plus = (prompt: string, count = 3) => canonicalImageRefs(prompt, count, 'qwenEditPlus')

describe('the label each encoder uses', () => {
  it('Qwen-Image 2.1 tags, Qwen-Image-Edit Picture N', () => {
    expect(canonicalImageRef(2, 'qwen21')).toBe('<image2>')
    expect(canonicalImageRef(2, 'qwenEditPlus')).toBe('Picture 2')
  })
})

describe('every spelling of an image that is there', () => {
  const spellings = [
    'image 2', 'IMAGE 2', 'Image 2', 'image2', 'Image2', 'IMAGE2', 'image  2', 'image #2', 'image # 2', 'image#2',
    'image no. 2', 'image no 2', 'image nr. 2', 'image number 2', 'image-2', 'image_2',
    'img 2', 'IMG2', 'img #2', 'picture 2', 'Picture 2', 'pic 2', 'PIC2', 'photo 2', 'Photo2',
    '<image2>', '<Image2>', '<image 2>', '< image2 >',
  ]
  for (const written of spellings) {
    it(`"${written}" becomes <image2> and Picture 2`, () => {
      expect(q21(`the pose from ${written} please`)).toBe('the pose from <image2> please')
      expect(plus(`the pose from ${written} please`)).toBe('the pose from Picture 2 please')
    })
  }

  it('a full stop, comma, colon, quote mark or bracket after it stays', () => {
    expect(q21('copy IMAGE 2.')).toBe('copy <image2>.')
    expect(q21('image 2, then image 3')).toBe('<image2>, then <image3>')
    expect(q21('Picture 2: the dog')).toBe('<image2>: the dog')
    expect(q21("image 2's jacket (image 3)")).toBe("<image2>'s jacket (<image3>)")
    expect(q21('image 2!')).toBe('<image2>!')
  })

  it('image 1 is the source and is named too', () => {
    expect(q21('the person in image 1 takes the pose of the person in image 2')).toBe('the person in <image1> takes the pose of the person in <image2>')
  })

  it('a range of ten images, all of them', () => {
    const prompt = Array.from({ length: 10 }, (_, i) => `image ${i + 1}`).join(' ')
    expect(q21(prompt, 10)).toBe(Array.from({ length: 10 }, (_, i) => `<image${i + 1}>`).join(' '))
  })

  it('at the very start and end of the prompt', () => {
    expect(q21('image 2')).toBe('<image2>')
    expect(q21('Image 2 wears the hat')).toBe('<image2> wears the hat')
  })

  it('Picture N for Qwen-Image 2.1 and <imageN> for Qwen-Image-Edit are taken over too', () => {
    expect(q21('Picture 2')).toBe('<image2>')
    expect(plus('<image2>')).toBe('Picture 2')
  })

  it('a prompt that is already in the encoder form is left as it is', () => {
    const done = 'Replace the shirt in <image1> with the shirt from <image2>.'
    expect(q21(done)).toBe(done)
    expect(q21(q21('image 2 and IMAGE 3'))).toBe('<image2> and <image3>')
  })
})

describe('no false hits', () => {
  it('numbers past the images there are stay as typed', () => {
    expect(q21('image 4', 3)).toBe('image 4')
    expect(q21('image 20', 3)).toBe('image 20')
    expect(q21('image 0', 3)).toBe('image 0')
    expect(q21('image 3', 2)).toBe('image 3')
    expect(q21('<image9>', 3)).toBe('<image9>')
  })

  it('a number that goes on is not an image number', () => {
    for (const text of ['image 2.5', 'image 2,5', 'image 2k', 'image 2x', 'image 2nd', 'image 21', 'image 1080p', 'image 1024', 'photo 2mm'])
      expect(q21(text, 3), text).toBe(text)
  })

  it('a measure after the number is a size, not an image', () => {
    expect(canonicalImageRefs('a photo 2 meters wide, image 2 at 3 cm', 3, 'qwen21')).toBe('a photo 2 meters wide, image 2 at 3 cm'.replace('image 2', '<image2>'))
    expect(canonicalImageRefs('picture 2 px offset, pic 2 x larger, image 2%', 2, 'qwenEditPlus')).toBe('picture 2 px offset, pic 2 x larger, image 2%')
    expect(canonicalImageRefs('image 2 extra', 2, 'qwenEditPlus')).toBe('Picture 2 extra')
  })

  it('counts and plurals are left alone', () => {
    for (const text of ['2 images', 'two images side by side', 'images 2 and 3', 'pictures 2', 'photos 2', 'the 2 image', 'image two'])
      expect(q21(text, 3), text).toBe(text)
  })

  it('a word that only ends or starts like one is left alone', () => {
    for (const text of ['subimage 2', 'imagery 2', 'topic 2', 'epic 2', 'telephoto 2', 'pictured 2', 'images2', 'photography 2'])
      expect(q21(text, 3), text).toBe(text)
  })

  it('reference N is left alone, it could mean image N or the Nth reference', () => {
    expect(q21('the hat from reference 1 and ref 2')).toBe('the hat from reference 1 and ref 2')
  })

  it('text in quotes is text for the picture and stays', () => {
    expect(q21('a sign that says "image 2" next to the dog from image 2')).toBe('a sign that says "image 2" next to the dog from <image2>')
    expect(q21('a poster reading “Picture 2”, image 3 style')).toBe('a poster reading “Picture 2”, <image3> style')
  })

  it('a half tag is kept as written, a ">" after a plain name is not eaten', () => {
    expect(q21('<image2 is broken')).toBe('<image2 is broken')
    expect(q21('image 2 > image 3')).toBe('<image2> > <image3>')
  })

  it('with one image, or none, nothing changes', () => {
    expect(q21('make image 1 brighter', 1)).toBe('make image 1 brighter')
    expect(q21('image 2', 0)).toBe('image 2')
    expect(q21('', 3)).toBe('')
  })
})

describe('the words the strip offers', () => {
  it('names the image in plain words and adds it with one space', () => {
    expect(imageRefWords(2)).toBe('image 2')
    expect(withImageRef('', 2)).toBe('image 2')
    expect(withImageRef('   ', 3)).toBe('image 3')
    expect(withImageRef('the pose of', 2)).toBe('the pose of image 2')
    expect(withImageRef('the pose of ', 2)).toBe('the pose of image 2')
  })

  it('what the strip adds reaches the model as its label', () => {
    expect(q21(withImageRef('the person in image 1 takes the pose of the person in', 2))).toBe('the person in <image1> takes the pose of the person in <image2>')
  })
})
