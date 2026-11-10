const base = "http://127.0.0.1:8804";
const password = "JobResponseTest!2026";
type Session = { cookie: string; csrf: string };
const pass: string[] = []; const ok = (v: unknown, m: string) => { if (!v) throw Error(m); pass.push(m); };
async function login(username: string): Promise<Session> { const r = await fetch(`${base}/api/login`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({username,password}) }); ok(r.status===204, `${username} login`); const cookie=r.headers.get("set-cookie")?.split(";")[0]; if(!cookie) throw Error("missing cookie"); const s=await fetch(`${base}/api/session`,{headers:{cookie}}); return {cookie,csrf:(await s.json() as any).csrfToken}; }
async function call(s:Session,path:string,method="GET",body?:unknown) { const r=await fetch(`${base}${path}`,{method,headers:{cookie:s.cookie,"x-csrf-token":s.csrf,...(body===undefined?{}:{"content-type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)}); return {r,b:await r.json().catch(()=>null)}; }
const admin=await login("TestAdmin");
for(const [username,role] of [["Rep Target","REP"],["Store Target","STOREKEEPER"]] as const) ok((await call(admin,"/api/accounts","POST",{username,password,role})).r.status===201,`creates ${username}`);
const rep=await login("Rep Target"), store=await login("Store Target");
ok((await call(rep,"/api/dispatch-targets?month=2026-11")).r.status===403,"Rep target GET denied");
ok((await call(store,"/api/dispatch-targets?month=2026-11")).r.status===403,"Storekeeper target GET denied");
ok((await call(rep,"/api/dispatch-targets","PUT",{month:"2026-11",orderTarget:1,valueTargetMinor:100})).r.status===403,"Rep target PUT denied");
let target=await call(admin,"/api/dispatch-targets?month=2026-11"); ok(target.r.ok&&target.b.target===null,"Unset target is explicit");
for(const body of [{month:"2026-11",orderTarget:0,valueTargetMinor:100,version:null},{month:"2026-11",orderTarget:1,valueTargetMinor:0,version:null},{month:"bad",orderTarget:1,valueTargetMinor:100,version:null}]) ok((await call(admin,"/api/dispatch-targets","PUT",body)).r.status===422,"Invalid target rejected");
const saved=await call(admin,"/api/dispatch-targets","PUT",{month:"2026-11",orderTarget:1,valueTargetMinor:10000,version:null}); ok(saved.r.ok&&saved.b.version===1,"Monthly target persists");
const november=await call(admin,"/api/dispatch-targets?month=2026-11"); ok(november.b.target.order_target===1&&november.b.target.value_target_minor===10000,"Target reload matches saved values");
const december=await call(admin,"/api/dispatch-targets?month=2026-12"); ok(december.b.target===null,"Targets do not silently carry into another month");
const stale=await call(admin,"/api/dispatch-targets","PUT",{month:"2026-11",orderTarget:2,valueTargetMinor:20000,version:1}); ok(stale.r.ok&&stale.b.version===2,"Current-version target update succeeds");
const conflict=await call(admin,"/api/dispatch-targets","PUT",{month:"2026-11",orderTarget:3,valueTargetMinor:30000,version:1}); ok(conflict.r.status===409,"Stale target update conflicts");
const afterConflict=await call(admin,"/api/dispatch-targets?month=2026-11"); ok(afterConflict.b.target.order_target===2&&afterConflict.b.target.value_target_minor===20000,"Stale update did not overwrite targets");
const buyer=(await call(admin,"/api/buyers","POST",{full_name:"Target Buyer",phone:"0770000000",address:"Target Address"})).b;
const product=(await call(admin,"/api/products","POST",{name:"Target Item",price_minor:10000})).b;
const create=async(key:string,price:number)=>{const x=await call(rep,"/api/quotations","POST",{idempotencyKey:key,buyerId:buyer.id,quotationDate:"2026-11-10",items:[{productId:product.id,quantity:1,unitPriceMinor:price}]});ok(x.r.status===201,`creates ${key}`);return x.b;};
const visible=await create("11111111-aaaa-4111-8111-111111111111",12345); const hidden=await create("22222222-bbbb-4222-8222-222222222222",23456); const cancelled=await create("33333333-cccc-4333-8333-333333333333",34567); const returned=await create("44444444-dddd-4444-8444-444444444444",45678);
ok((await call(admin,`/api/quotations/${cancelled.id}/cancel`,"POST",{reason:"test"})).r.ok,"cancels order");
for(const order of [visible,hidden,returned]) { const detail=(await call(store,`/api/quotations/${order.id}`)).b; ok((await call(store,`/api/quotations/${order.id}/packing`,"PUT",{version:detail.dispatch_version,items:detail.items.map((i:any)=>({productId:i.product_id,checked:true}))})).r.ok,"packs order"); ok((await call(store,`/api/quotations/${order.id}/dispatch`,"POST",{})).r.ok,"dispatches order"); }
ok((await call(admin,`/api/quotations/${hidden.id}/visibility`,"PUT",{hidden:true})).r.ok,"hides dispatched order");
ok((await call(admin,`/api/quotations/${returned.id}/return-to-pending`,"POST",{reason:"target test"})).r.ok,"returns order to pending");
const actual=await call(admin,"/api/dispatch-targets?month=2026-11"); ok(actual.b.actual.orders===2&&actual.b.actual.valueMinor===35801,"Actuals include hidden saved totals and exclude cancelled/pending");
const exact=await call(admin,"/api/dispatch-targets","PUT",{month:"2026-11",orderTarget:2,valueTargetMinor:35801,version:actual.b.target.version}); ok(exact.r.ok,"Sets exact-achievement target");
const achieved=await call(admin,"/api/dispatch-targets?month=2026-11"); ok(achieved.b.actual.orders===2&&achieved.b.target.order_target===2&&achieved.b.actual.valueMinor===achieved.b.target.value_target_minor,"Exactly achieved count and saved value remain accurate");
const extra=await create("55555555-eeee-4555-8555-555555555555",11111); const extraDetail=(await call(store,`/api/quotations/${extra.id}`)).b; await call(store,`/api/quotations/${extra.id}/packing`,"PUT",{version:extraDetail.dispatch_version,items:extraDetail.items.map((i:any)=>({productId:i.product_id,checked:true}))}); await call(store,`/api/quotations/${extra.id}/dispatch`,"POST",{});
const exceeded=await call(admin,"/api/dispatch-targets?month=2026-11"); ok(exceeded.b.actual.orders===3&&exceeded.b.target.order_target===2&&exceeded.b.actual.valueMinor===46912&&exceeded.b.actual.valueMinor>exceeded.b.target.value_target_minor,"Overachievement returns uncapped count and value");
const beforePush=await call(admin,"/api/test/push-state"); await call(admin,"/api/dispatch-targets?month=2026-11"); const afterPush=await call(admin,"/api/test/push-state"); ok(JSON.stringify(beforePush.b)===JSON.stringify(afterPush.b),"Dashboard GET does not trigger push processing");
console.log(JSON.stringify({ok:true,pass,ids:{visible:visible.id,hidden:hidden.id,cancelled:cancelled.id,returned:returned.id}},null,2));
