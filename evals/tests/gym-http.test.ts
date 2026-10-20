import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { test } from 'node:test';
import {
  HarnessError,
  harnessRequest,
  openForward,
  type Endpoint,
  type HttpReply,
} from '../gym/http.ts';
import type { Kubectl } from '../gym/kubectl.ts';

class FakeForward implements Endpoint {
  restarts = 0;
  stopped = false;
  private local = 4100;

  constructor(
    readonly service = 'sim-google',
    private readonly exitedFlag = false,
  ) {}

  port() {
    return this.local;
  }

  url(path = '') {
    return `http://127.0.0.1:${this.local}${path}`;
  }

  exited() {
    return this.exitedFlag;
  }

  async restart() {
    this.restarts++;
    this.local++;
  }

  stop() {
    this.stopped = true;
  }
}

function response(): HttpReply {
  return {
    ok: true,
    status: 200,
    text: async () => '{}',
    json: async () => ({}),
  };
}

function networkError(code: string) {
  return Object.assign(new Error('fetch failed'), { cause: { code } });
}

test('harness request retries a reset connection on a fresh port', async () => {
  const target = new FakeForward();
  const calls: string[] = [];
  const sleeps: number[] = [];
  const send = async (url: string) => {
    calls.push(url);
    if (calls.length <= 2) throw networkError('ECONNRESET');
    return response();
  };
  const result = await harnessRequest(
    target,
    'Collecting sim-google state',
    '/_sim/v1/tenants/gym/state',
    {},
    {
      send,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    },
  );
  assert.equal(result.status, 200);
  assert.equal(calls.length, 3);
  assert.equal(target.restarts, 2);
  assert.deepEqual(sleeps, [200, 400]);
  assert.equal(new URL(calls[2]!).port, '4102');
});

test('harness request reports the step, target and cause after four attempts', async () => {
  const target = new FakeForward();
  const send = async () => {
    throw networkError('ECONNRESET');
  };
  await assert.rejects(
    harnessRequest(
      target,
      'Collecting sim-google state',
      '/_sim/v1/tenants/gym/state',
      {},
      {
        send,
        sleep: async () => {},
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HarnessError);
      assert.equal(error.step, 'Collecting sim-google state');
      assert.equal(error.target, 'sim-google /_sim/v1/tenants/gym/state');
      assert.equal(error.detail, 'ECONNRESET after 4 attempts');
      assert.match(error.message, /Collecting sim-google state failed/);
      return true;
    },
  );
  assert.equal(target.restarts, 3);
});

test('harness request retries a timeout without restarting the forward', async () => {
  const target = new FakeForward();
  const sleeps: number[] = [];
  const send = async () => {
    throw networkError('ETIMEDOUT');
  };
  await assert.rejects(
    harnessRequest(
      target,
      'Collecting sim-google state',
      '/state',
      {},
      {
        send,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      },
    ),
    HarnessError,
  );
  assert.equal(target.restarts, 0);
  assert.deepEqual(sleeps, [200, 400, 800]);
});

test('harness request restarts a forward whose process exited', async () => {
  const target = new FakeForward('sim-google', true);
  const send = async () => {
    throw networkError('UND_ERR_SOCKET');
  };
  await assert.rejects(
    harnessRequest(
      target,
      'Collecting sim-google state',
      '/state',
      {},
      {
        send,
        sleep: async () => {},
      },
    ),
    HarnessError,
  );
  assert.equal(target.restarts, 3);
});

test('open forward restarts on a fresh local port', async () => {
  const ports = [5101, 5102];
  const children = [
    { exitCode: 1, signalCode: null, kill() {} },
    { exitCode: null, signalCode: null, kill() {} },
  ] as unknown as ChildProcess[];
  let spawned = 0;
  const kubectl = {
    async forward() {
      return children[spawned++]!;
    },
  } as unknown as Kubectl;
  const endpoint = await openForward({
    kubectl,
    namespace: 'otto-eval',
    target: 'svc/sim-google',
    remote: 9090,
    service: 'sim-google',
    freePort: async () => ports.shift()!,
    portOpen: async () => true,
  });
  assert.equal(endpoint.port(), 5101);
  assert.equal(endpoint.exited(), true);
  await endpoint.restart();
  assert.equal(endpoint.port(), 5102);
  assert.equal(endpoint.exited(), false);
  assert.equal(spawned, 2);
  endpoint.stop();
});
