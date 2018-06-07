const test = require("nefarious");
const cuplex = require(".");

test("Simple discussion", async t => {
  const rx = cuplex(async tx => tx.send(5));
  t.is(await rx.recv(), 5);
});

test("Dialog", async t => {
  const rx = cuplex(async tx => tx.send((await tx.recv()) * 2));
  rx.send(5);
  t.is(await rx.recv(), 10);
});

test("Networking", async t => {
  const worker = tx => tx.send(5);
  const workers = [worker, worker, worker, worker];
  const rx = cuplex.pool(workers);
  const sum = await workers.reduce(
    async (value, worker) => (await value) + (await rx.recv()),
    0
  );
  t.is(sum, 20);
});

test("Broadcasting", async t => {
  const worker = async tx => tx.send(await tx.recv());
  const workers = [worker, worker, worker, worker];
  const rx = cuplex.pool(workers);
  rx.send(5);
  const sum = await workers.reduce(
    async (value, worker) => (await value) + (await rx.recv()),
    0
  );
  t.is(sum, 20);
});

test("Mutex", async t => {
  const mtx = cuplex.mutex(3);
  const arr = [];
  Array.from({ length: 6 }).forEach(async () => {
    const release = await mtx.acquire();
    arr.push(release);
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  t.is(arr.length, 3);
  arr.forEach(r => r());
  await new Promise(resolve => setTimeout(resolve, 50));
  t.is(arr.length, 6);
});
