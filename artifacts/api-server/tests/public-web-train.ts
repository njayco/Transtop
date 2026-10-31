import assert from "node:assert/strict";
import { mock, test } from "node:test";

const observed = { id: "amtrak:observed", routeName: "Regional", trainNumber: "1" };
mock.module("@workspace/db", { exports: { pool: { query: async () => ({ rows: [{ data: { trains: [observed] } }] }) } } });
const scheduled = mock.fn(async (id: string) => id === "amtrak:scheduled" ? { id } : undefined);
mock.module(new URL("../src/transit/amtrak-service.ts", import.meta.url).href, { exports: { amtrakTrainDetail: scheduled } });
const { publicTrain } = await import("../src/public-web/train");

test("web process recognizes persisted observed train identities without starting another poller", async () => {
  assert.equal((await publicTrain(observed.id))?.id, observed.id);
  assert.equal(scheduled.mock.callCount(), 0);
  assert.equal((await publicTrain("amtrak:scheduled"))?.id, "amtrak:scheduled");
  assert.equal(await publicTrain("missing"), undefined);
});
