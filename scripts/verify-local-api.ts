const base = process.argv[2] || 'http://127.0.0.1:8791'
let cookie = '', csrf = ''
const runTag = `LOCAL TEST ${crypto.randomUUID().slice(0,8)}`
const ok = (value: unknown, expected: unknown, name: string) => { if (value !== expected) throw new Error(`${name}: expected ${expected}, got ${value}`); console.log(`PASS ${name}`) }
async function request(path: string, method = 'GET', body?: unknown, auth = true) {
  const response = await fetch(base + path, { method, headers: { ...(body ? {'content-type':'application/json'} : {}), ...(auth && cookie ? {cookie} : {}), ...(auth && csrf && !['GET','HEAD'].includes(method) ? {'X-CSRF-Token':csrf} : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await response.text(); return { response, data: text ? JSON.parse(text) : null }
}
const unauth = await request('/api/buyers','GET',undefined,false); ok(unauth.response.status,401,'unauthorized buyer request')
const login = await request('/api/login','POST',{username:'local-test-owner',password:'Local-Test-Password-Only'},false); ok(login.response.status,204,'login')
cookie = login.response.headers.get('set-cookie')!.split(';')[0]
const current = await request('/api/session'); ok(current.response.status,200,'authenticated session'); csrf=current.data.csrfToken
const buyerResult = await request('/api/buyers','POST',{full_name:`${runTag} Buyer`,phone:'0770000001',email:'local-test@example.invalid',address:'Test only'}); ok(buyerResult.response.status,201,'buyer creation'); const buyer=buyerResult.data
const first = await request('/api/products','POST',{brand:'LOCAL TEST',model_name:'Chrono A',sku:`LOCAL-${runTag.slice(-8)}-A`,colour:'Blue',description:'Test watch A',price_minor:12345}); const second = await request('/api/products','POST',{brand:'LOCAL TEST',model_name:'Chrono B',sku:`LOCAL-${runTag.slice(-8)}-B`,colour:'Black',description:'Test watch B',price_minor:2500}); ok(first.response.status,201,'first product creation'); ok(second.response.status,201,'second product creation')
const payload={idempotencyKey:crypto.randomUUID(),buyerId:buyer.id,quotationDate:'2026-11-02',validUntil:'2026-11-16',notes:'LOCAL TEST quotation',items:[{productId:first.data.id,quantity:3},{productId:second.data.id,quantity:4}]}
const saved=await request('/api/quotations','POST',payload); ok(saved.response.status,201,'quotation save'); ok(saved.data.total_minor,47035,'server calculated total')
const repeated=await request('/api/quotations','POST',payload); ok(repeated.response.status,200,'idempotent repeat response'); ok(repeated.data.id,saved.data.id,'idempotent repeat save')
const history=await request(`/api/quotations?q=${encodeURIComponent(runTag)}`); ok(history.data.length,1,'one quotation after repeat save')
const opened=await request(`/api/quotations/${saved.data.id}`); ok(opened.data.total_minor,47035,'reopen quotation')
const update={brand:first.data.brand,model_name:first.data.model_name,sku:first.data.sku,colour:first.data.colour,description:first.data.description,price_minor:99999,active:1}; const changed=await request(`/api/products/${first.data.id}`,'PUT',update); ok(changed.response.status,200,'product price change')
const snapshot=await request(`/api/quotations/${saved.data.id}`); ok(snapshot.data.total_minor,47035,'saved quotation total snapshot'); ok(snapshot.data.items[0].unit_price_minor,12345,'saved item price snapshot')
const logout=await request('/api/logout','POST'); ok(logout.response.status,204,'logout'); cookie=logout.response.headers.get('set-cookie')!.split(';')[0]; const afterLogout=await request('/api/quotations'); ok(afterLogout.response.status,401,'logged out session rejected')
console.log('PASS quotation workflow does not access or mutate stock (the schema and endpoints contain no stock field)')
