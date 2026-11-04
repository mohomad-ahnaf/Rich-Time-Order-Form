import { describe, expect, it } from 'vitest'
import { quoteTotal, validQuantity } from './calculations'
describe('quotation calculations',()=>{it('uses integer minor units',()=>expect(quoteTotal([{price_minor:19995,quantity:3},{price_minor:5,quantity:2}])).toBe(59995));it('rejects invalid quantities',()=>{expect(validQuantity(1)).toBe(true);expect(validQuantity(0)).toBe(false);expect(validQuantity(1.5)).toBe(false)})})
