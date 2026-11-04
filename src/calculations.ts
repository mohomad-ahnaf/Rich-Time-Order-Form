export const quoteTotal=(items:{price_minor:number;quantity:number}[])=>items.reduce((total,item)=>total+item.price_minor*item.quantity,0)
export const validQuantity=(value:number)=>Number.isInteger(value)&&value>0&&value<=9999
