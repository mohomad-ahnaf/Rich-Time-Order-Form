import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { jsPDF } from 'jspdf'
import * as autoTableModule from 'jspdf-autotable'

const pdf = new jsPDF()
pdf.setFontSize(19); pdf.text('LOCAL TEST Watch Shop',14,18)
pdf.setFontSize(22); pdf.text('QUOTATION',145,18)
pdf.setFontSize(10); pdf.text('No: LOCAL-PDF-MULTIPAGE\nDate: 2026-11-03',145,25)
const rows = Array.from({length:48},(_,index)=>[`LOCAL TEST Watch ${index+1}`,`SKU LOCAL-${index+1}\nA deliberately long description used to verify wrapping and repeated headers over multiple PDF pages.`,String(index%4+1),'LKR 12,345.00','LKR 49,380.00'])
const autoTable = (autoTableModule as unknown as {default?:{default?:Function}}).default?.default
if (!autoTable) throw new Error('Unable to load jspdf-autotable')
autoTable(pdf,{startY:54,head:[['Item','Description','Quantity','Unit Price (Rs.)','Total (Rs.)']],body:rows,foot:[['','','','','Grand Total LKR 2,370,240.00']],theme:'grid',styles:{fontSize:8},headStyles:{fillColor:[17,42,70]},didDrawPage:({pageNumber}:{pageNumber:number})=>{pdf.text(`Page ${pageNumber}`,190,290,{align:'right'})}})
const pageCount=pdf.getNumberOfPages()
if(pageCount < 2) throw new Error(`Expected a multipage PDF, received ${pageCount} page`)
mkdirSync('.wrangler',{recursive:true}); const target='.wrangler/pdf-layout-test.pdf'; writeFileSync(target,Buffer.from(pdf.output('arraybuffer')))
if(statSync(target).size < 5000) throw new Error('PDF output is unexpectedly small')
console.log(`PASS multipage PDF generated (${pageCount} pages) at ${target}`)
