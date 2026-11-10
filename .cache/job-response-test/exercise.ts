const base = "http://127.0.0.1:8802";
const password = "JobResponseTest!2026";
type Session = { cookie: string; csrf: string; id: number; username: string };
const passed: string[] = [];
const expect = (condition: unknown, message: string) => { if (!condition) throw Error(message); passed.push(message); };
async function login(username: string): Promise<Session> {
  const response = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  expect(response.status === 204, `${username} login`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw Error(`Missing ${username} session cookie`);
  const session = await fetch(`${base}/api/session`, { headers: { cookie } });
  expect(session.ok, `${username} session restore`);
  const body = await session.json() as { userId: number; username: string; csrfToken: string };
  return { cookie, csrf: body.csrfToken, id: body.userId, username: body.username };
}
async function call(session: Session, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie: session.cookie, "x-csrf-token": session.csrf, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { response, body: await response.json().catch(() => null) };
}
async function createJob(admin: Session, repId: number, title: string, buyerId: number, key: string) {
  const result = await call(admin, "/api/jobs", "POST", { idempotencyKey: key, repId, title, locationQuery: "Test Address", buyerIds: [buyerId] });
  expect(result.response.status === 201, `${title} created awaiting response`);
  expect(result.body.response_status === "AWAITING_RESPONSE", `${title} starts Awaiting response`);
  return result.body as { id: number; response_status: string; items: Array<{ id: number; version: number }> };
}
const admin = await login("TestAdmin");
for (const [username, role] of [["Rep A", "REP"], ["Rep B", "REP"], ["Storekeeper", "STOREKEEPER"]] as const) {
  const result = await call(admin, "/api/accounts", "POST", { username, password, role });
  expect(result.response.status === 201, `Admin creates ${username}`);
}
const accounts = (await call(admin, "/api/accounts")).body as Array<{ id: number; username: string }>;
const repARecord = accounts.find((account) => account.username === "Rep A")!;
const repBRecord = accounts.find((account) => account.username === "Rep B")!;
const repA = await login("Rep A"), repB = await login("Rep B"), storekeeper = await login("Storekeeper");
const subscription = (endpoint: string) => ({ endpoint, keys: { p256dh: "test-p256dh-key", auth: "test-auth-key" } });
expect((await call(repA, "/api/push/subscriptions", "POST", subscription("https://push-test.example/rep-a"))).response.status === 201, "Rep A registers mock device");
expect((await call(repB, "/api/push/subscriptions", "POST", subscription("https://push-test.example/rep-b"))).response.status === 201, "Rep B registers mock device");
expect((await call(admin, "/api/push/subscriptions", "POST", subscription("https://push-test.example/admin"))).response.status === 201, "Admin registers mock device");
const buyerResult = await call(admin, "/api/buyers", "POST", { full_name: "Job Response Buyer", phone: "0770000000", address: "Test Address" });
expect(buyerResult.response.status === 201, "Admin creates test buyer");
const buyerId = buyerResult.body.id as number;

const awaiting = await createJob(admin, repARecord.id, "Awaiting job", buyerId, "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
await new Promise((resolve) => setTimeout(resolve, 100));
const assignmentInbox = await call(repA, "/api/notifications?limit=20");
const assignmentNotification = assignmentInbox.body.notifications.find((notification: { type: string; target_id: number }) => notification.type === "JOB_ASSIGNED" && notification.target_id === awaiting.id);
expect(Boolean(assignmentNotification), "Assignment creates Rep inbox event");
const assignmentDelivery = await call(repA, `/api/notifications/${assignmentNotification.id}/delivery`);
expect(Boolean(assignmentDelivery.body.delivered_at), "Assignment outbox is immediately claimed and mock-delivered");
const assignmentPushCalls = await call(admin, "/api/test/push-state");
expect(assignmentPushCalls.body.calls["https://push-test.example/rep-a"] === 1, "Assignment endpoint schedules one targeted push attempt");
expect((await call(admin, `/api/jobs/${awaiting.id}`, "PUT", { title: "Awaiting job updated", instructions: "Updated", dueDate: null })).response.status === 200, "Admin updates job");
await new Promise((resolve) => setTimeout(resolve, 100));
const updateInbox = await call(repA, "/api/notifications?limit=20");
const updateNotification = updateInbox.body.notifications.find((notification: { type: string; target_id: number }) => notification.type === "JOB_UPDATED" && notification.target_id === awaiting.id);
expect(Boolean(updateNotification), "Job update creates Rep inbox event");
expect(Boolean((await call(repA, `/api/notifications/${updateNotification.id}/delivery`)).body.delivered_at), "Job update is immediately mock-delivered");
expect((await call(repA, `/api/jobs/${awaiting.id}/items/${awaiting.items[0].id}`, "PUT", { visited: true, version: awaiting.items[0].version })).response.status === 422, "Checklist is blocked while awaiting response");
expect((await call(repB, `/api/jobs/${awaiting.id}/response`, "POST", { response: "ACCEPT" })).response.status === 404, "Other Rep cannot respond");
expect((await call(storekeeper, `/api/jobs/${awaiting.id}/response`, "POST", { response: "ACCEPT" })).response.status === 403, "Storekeeper cannot respond");
expect((await call(repA, `/api/jobs/${awaiting.id}/response`, "POST", { response: "REJECT" })).response.status === 422, "Rejection reason is required");

const race = await createJob(admin, repARecord.id, "Race job", buyerId, "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2");
const [accepted, rejected] = await Promise.all([
  call(repA, `/api/jobs/${race.id}/response`, "POST", { response: "ACCEPT" }),
  call(repA, `/api/jobs/${race.id}/response`, "POST", { response: "REJECT", reason: "Calendar conflict" }),
]);
expect([accepted.response.status, rejected.response.status].filter((status) => status === 200).length === 1 && [accepted.response.status, rejected.response.status].includes(409), "Concurrent Accept/Reject has exactly one winner");
const raceDetail = await call(repA, `/api/jobs/${race.id}`);
expect(["ACCEPTED", "REJECTED"].includes(raceDetail.body.response_status), "Concurrent winner persisted");

const retry = await createJob(admin, repARecord.id, "Retry job", buyerId, "ccccccc3-cccc-4ccc-8ccc-ccccccccccc3");
const firstAccept = await call(repA, `/api/jobs/${retry.id}/response`, "POST", { response: "ACCEPT" });
const secondAccept = await call(repA, `/api/jobs/${retry.id}/response`, "POST", { response: "ACCEPT" });
expect(firstAccept.response.status === 200 && secondAccept.response.status === 200 && secondAccept.body.response_status === "ACCEPTED", "Identical response retry returns the saved result");
await new Promise((resolve) => setTimeout(resolve, 100));
const responseInbox = await call(admin, "/api/notifications?limit=100");
const acceptanceNotification = responseInbox.body.notifications.find((notification: { type: string; target_id: number }) => notification.type === "JOB_ACCEPTED" && notification.target_id === retry.id);
expect(Boolean(acceptanceNotification), "Acceptance creates Admin inbox event");
const acceptanceDelivery = await call(admin, `/api/notifications/${acceptanceNotification.id}/delivery`);
expect(Boolean(acceptanceDelivery.body.delivered_at), "Acceptance outbox is immediately claimed and mock-delivered");
const responsePushCalls = await call(admin, "/api/test/push-state");
expect((responsePushCalls.body.calls["https://push-test.example/admin"] || 0) >= 1, "Acceptance endpoint schedules targeted Admin push");
const afterAccept = await call(repA, `/api/jobs/${retry.id}`);
const completed = await call(repA, `/api/jobs/${retry.id}/items/${afterAccept.body.items[0].id}`, "PUT", { visited: true, version: afterAccept.body.items[0].version });
expect(completed.response.status === 200 && completed.body.status === "COMPLETED", "Checklist is enabled after acceptance and completes the job");
await new Promise((resolve) => setTimeout(resolve, 100));
const completedInbox = await call(admin, "/api/notifications?limit=100");
const completedNotification = completedInbox.body.notifications.find((notification: { type: string; target_id: number }) => notification.type === "JOB_COMPLETED" && notification.target_id === retry.id);
expect(Boolean(completedNotification) && Boolean((await call(admin, `/api/notifications/${completedNotification.id}/delivery`)).body.delivered_at), "Completion is immediately mock-delivered");
const reopened = await call(repA, `/api/jobs/${retry.id}/items/${completed.body.items[0].id}`, "PUT", { visited: false, version: completed.body.items[0].version });
expect(reopened.response.status === 200 && reopened.body.status === "ACTIVE", "Rep can reopen completed job progress");
await new Promise((resolve) => setTimeout(resolve, 100));
const reopenedInbox = await call(admin, "/api/notifications?limit=100");
const reopenedNotification = reopenedInbox.body.notifications.find((notification: { type: string; target_id: number }) => notification.type === "JOB_REOPENED" && notification.target_id === retry.id);
expect(Boolean(reopenedNotification) && Boolean((await call(admin, `/api/notifications/${reopenedNotification.id}/delivery`)).body.delivered_at), "Reopening is immediately mock-delivered");

const rejectedJob = await createJob(admin, repARecord.id, "Rejected job", buyerId, "ddddddd4-dddd-4ddd-8ddd-ddddddddddd4");
const rejection = await call(repA, `/api/jobs/${rejectedJob.id}/response`, "POST", { response: "REJECT", reason: "Vehicle unavailable" });
expect(rejection.response.status === 200 && rejection.body.rejection_reason === "Vehicle unavailable", "Rejection reason persists");
const rejectedDetail = await call(repA, `/api/jobs/${rejectedJob.id}`);
expect((await call(repA, `/api/jobs/${rejectedJob.id}/items/${rejectedDetail.body.items[0].id}`, "PUT", { visited: true, version: rejectedDetail.body.items[0].version })).response.status === 422, "Checklist remains blocked after rejection");
const rejectedList = await call(repA, "/api/jobs?status=rejected");
expect(rejectedList.response.ok && rejectedList.body.some((job: { id: number }) => job.id === rejectedJob.id), "Rejected job filter returns rejected job");

const cancelled = await createJob(admin, repBRecord.id, "Cancelled job", buyerId, "eeeeeee5-eeee-4eee-8eee-eeeeeeeeeee5");
expect((await call(admin, `/api/jobs/${cancelled.id}/cancel`, "POST", { reason: "No longer required" })).response.status === 200, "Admin cancels awaiting job");
await new Promise((resolve) => setTimeout(resolve, 100));
const cancellationInbox = await call(repB, "/api/notifications?limit=20");
const cancellationNotification = cancellationInbox.body.notifications.find((notification: { type: string; target_id: number }) => notification.type === "JOB_CANCELLED" && notification.target_id === cancelled.id);
expect(Boolean(cancellationNotification) && Boolean((await call(repB, `/api/notifications/${cancellationNotification.id}/delivery`)).body.delivered_at), "Cancellation is immediately mock-delivered");
expect((await call(repB, `/api/jobs/${cancelled.id}/response`, "POST", { response: "ACCEPT" })).response.status === 422, "Cancelled job rejects response");

const adminInbox = await call(admin, "/api/notifications?limit=100");
const responseNotifications = adminInbox.body.notifications.filter((notification: { type: string }) => notification.type === "JOB_ACCEPTED" || notification.type === "JOB_REJECTED");
expect(responseNotifications.length === 3, "Admins receive one notification per committed response");
const retryNotifications = responseNotifications.filter((notification: { target_id: number }) => notification.target_id === retry.id);
expect(retryNotifications.length === 1, "Identical retry creates no duplicate notification");
expect((await call(admin, `/api/jobs/${retry.id}`)).response.status === 200, "Admin can open authorized notification job detail");
expect((await call(repB, `/api/jobs/${retry.id}`)).response.status === 404, "Other Rep cannot navigate to another Rep job");
console.log(JSON.stringify({ ok: true, passed, ids: { awaiting: awaiting.id, race: race.id, retry: retry.id, rejected: rejectedJob.id } }, null, 2));
