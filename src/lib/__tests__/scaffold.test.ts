import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('scaffold', () => {
  it('resolve o alias @ e executa utilitário', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('descarta valores falsos', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
  })
})
