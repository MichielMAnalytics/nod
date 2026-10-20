import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKubectl } from './kubectl.ts';
import {
  prepareCluster,
  regradeTask,
  runTask,
  validateWorlds,
  type RunConfig,
  type SavedSession,
  type TaskResult,
} from './runner.ts';
import { stopForwards } from './http.ts';
import { installTaskLogs } from './log.ts';
import { runPool } from './parallel.ts';
import type { Task } from './task.ts';
import { findTask, gymTasks } from './tasks/index.ts';
import { fakesNamespace } from './world.ts';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const environment = process.env;

async function exitWith(code: number): Promise<never> {
  stopForwards();
  const streams = [process.stdout, process.stderr];
  await Promise.all(
    streams.map(
      (stream) =>
        new Promise<void>((done) => {
          const timer = setTimeout(done, 500);
          timer.unref();
          stream.write('', () => {
            clearTimeout(timer);
            done();
          });
        }),
    ),
  );
  process.exit(code);
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function required(name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

const wanted = argument('--task') || 'all';
if (process.argv.includes('--validate-worlds')) {
  const tasks = await gymTasks();
  const selected =
    wanted === 'all'
      ? tasks
      : [findTask(tasks, wanted)].filter((task): task is NonNullable<typeof task> => Boolean(task));
  if (!selected.length)
    throw new Error(
      `No gym task matches ${wanted}. Available: ${tasks.map((item) => item.id).join(', ')}.`,
    );
  const namespace = environment.OTTO_EVAL_NAMESPACE?.trim() || 'otto-eval';
  const config: RunConfig = {
    root,
    runId: 'validate-worlds',
    namespace,
    fakesNamespace: fakesNamespace(environment),
    research: environment.NAMESPACE?.trim() || 'research',
    provider: '',
    model: '',
    keyVariable: '',
    llmKey: '',
    harnessToken: required('SIM_HARNESS_TOKEN'),
    image: '',
    workspaceImage: '',
    browserImage: '',
    faketimeImage: '',
    template: '',
    postgresTemplate: '',
    turnSeconds: 0,
    taskUsd: 0,
    keep: false,
    ottoPort: 0,
    kubectl: createKubectl(environment.CONTEXT?.trim() || undefined),
  };
  const results = await validateWorlds(config, selected);
  const passed = results.filter((result) => result.passed);
  console.log(
    `\nWorlds: ${passed.length}/${results.length} passed.${
      passed.length === results.length
        ? ''
        : ` Failed: ${results
            .filter((result) => !result.passed)
            .map((result) => result.task)
            .join(', ')}`
    }`,
  );
  await exitWith(passed.length === results.length ? 0 : 1);
}

const regradeValue = argument('--regrade');
const regrade = regradeValue
  ? {
      run: regradeValue.slice(0, regradeValue.lastIndexOf('/')),
      task: regradeValue.slice(regradeValue.lastIndexOf('/') + 1),
    }
  : undefined;
if (regradeValue && (!regrade?.run || !regrade.task))
  throw new Error('Use --regrade <run>/<task>.');

const provider = environment.LLM_PROVIDER?.trim() || 'openrouter';
const keyVariable = regrade
  ? ''
  : provider === 'openai'
    ? 'OPENAI_API_KEY'
    : provider === 'anthropic'
      ? 'ANTHROPIC_API_KEY'
      : provider === 'openrouter'
        ? 'OPENROUTER_API_KEY'
        : undefined;
if (!regrade && !keyVariable)
  throw new Error('Set LLM_PROVIDER to openrouter, openai or anthropic.');
const model = regrade
  ? ''
  : (environment.LLM_MODEL?.trim() || 'deepseek/deepseek-v4.1-flash-1017').replace(
      new RegExp(`^${provider}/`),
      '',
    );
const runId =
  regrade?.run ||
  environment.RUN_ID?.trim() ||
  `gym-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 12)}`;
if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(runId))
  throw new Error('RUN_ID must be a lowercase DNS label.');
const namespace = environment.OTTO_EVAL_NAMESPACE?.trim() || 'otto-eval';
const config: RunConfig = {
  root,
  runId,
  namespace,
  fakesNamespace: fakesNamespace(environment),
  research: environment.NAMESPACE?.trim() || 'research',
  provider,
  model,
  keyVariable: keyVariable ?? '',
  llmKey: regrade || !keyVariable ? '' : required(keyVariable),
  harnessToken: required('SIM_HARNESS_TOKEN'),
  image: regrade ? '' : required('OTTO_IMAGE'),
  workspaceImage: regrade ? '' : required('WORKSPACE_IMAGE'),
  browserImage: regrade ? '' : required('BROWSER_IMAGE'),
  faketimeImage:
    environment.FAKETIME_IMAGE?.trim() ||
    'debian:bookworm-slim@sha256:a4672c0cb26fbdde88e38fa2dfb6c681942306680e41e4378b28770b6e79ee91',
  template: '',
  postgresTemplate: '',
  turnSeconds: Number(environment.TURN_TIMEOUT_SECONDS || 1200),
  taskUsd: Number(environment.TASK_CHECKIN_USD || 50),
  keep: environment.KEEP === '1',
  ottoPort: 4310,
  kubectl: createKubectl(environment.CONTEXT?.trim() || undefined),
};

const tasks = await gymTasks();

async function writeSummary(results: TaskResult[], merge = false) {
  const directory = resolve(root, 'results', runId);
  await mkdir(directory, { recursive: true });
  let combined = results;
  if (merge) {
    try {
      const existing = JSON.parse(await readFile(resolve(directory, 'summary.json'), 'utf8')) as {
        tasks?: Array<Record<string, any>>;
      };
      const previous = (existing.tasks ?? []).map((task) => ({
        ...task,
        resultPath: task.file ?? '',
      })) as TaskResult[];
      combined = [
        ...previous.filter((task) => !results.some((result) => result.task === task.task)),
        ...results,
      ];
    } catch {}
  }
  await writeFile(
    resolve(directory, 'summary.json'),
    JSON.stringify(
      {
        run: runId,
        at: new Date().toISOString(),
        passed: combined.length > 0 && combined.every((result) => result.passed),
        tasks: combined.map(({ resultPath, ...result }) => ({ ...result, file: resultPath })),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\nSummary: ${resolve(directory, 'summary.json')}`);
}

if (regrade) {
  const task = findTask(tasks, regrade.task);
  if (!task)
    throw new Error(
      `No gym task matches ${regrade.task}. Available: ${tasks.map((item) => item.id).join(', ')}.`,
    );
  const saved = JSON.parse(
    await readFile(resolve(root, 'results', runId, `${task.id}.session.json`), 'utf8'),
  ) as SavedSession;
  if (saved.version !== 1 || saved.task !== task.id || saved.run !== runId)
    throw new Error(`The saved session for ${runId}/${task.id} does not match this run.`);
  const result = await regradeTask(config, task, saved);
  await writeSummary([result], true);
  console.log(result.summary);
  await exitWith(result.passed ? 0 : 1);
}

const mtp = resolve(environment.MTP_GYM_REPO?.trim() || resolve(root, '../mtp-gym'));
const workload = resolve(mtp, 'infra/gcp/research-cluster/workloads/otto-eval');
config.template = await readFile(
  environment.OTTO_EVAL_TEMPLATE?.trim() || resolve(workload, 'otto-pod.yaml.tmpl'),
  'utf8',
);
config.postgresTemplate = await readFile(
  environment.OTTO_EVAL_POSTGRES_TEMPLATE?.trim() || resolve(workload, 'postgres.yaml.tmpl'),
  'utf8',
);

const parallel = Number(argument('--parallel') ?? 1);
if (!Number.isInteger(parallel) || parallel < 1)
  throw new Error('--parallel must be a positive whole number.');
const selected =
  wanted === 'all'
    ? tasks
    : wanted
        .split(',')
        .map((name) => findTask(tasks, name.trim()))
        .filter((task): task is NonNullable<typeof task> => Boolean(task));
if (!selected.length)
  throw new Error(
    `No gym task matches ${wanted}. Available: ${tasks.map((task) => task.id).join(', ')}.`,
  );

function unfinished(task: Task): TaskResult {
  return {
    task: task.id,
    title: task.title,
    run: runId,
    tenant: '',
    at: new Date().toISOString(),
    passed: false,
    summary: `FAIL ${task.id}: the run did not finish`,
    counts: {
      Setup: { pass: 0, total: 0 },
      Reach: { pass: 0, total: 0 },
      Outcome: { pass: 0, total: 0 },
      Safety: { pass: 0, total: 0 },
    },
    checks: [],
    resultPath: '',
  };
}

await prepareCluster(config);
installTaskLogs();
const outcomes = await runPool({
  tasks: selected,
  parallel,
  prefix: parallel > 1,
  run: async (task) => {
    try {
      return await runTask(config, task);
    } catch (error) {
      console.error(`\nrun failed: ${error instanceof Error ? error.message : error}`);
      return unfinished(task);
    }
  },
});
const results: TaskResult[] = outcomes.map((outcome) => {
  if (outcome.result) return outcome.result;
  console.error(`\nrun failed: ${String(outcome.error)}`);
  return unfinished(outcome.task);
});
await writeSummary(results);
for (const result of results) {
  console.log(result.summary);
  if (result.harnessFailure && result.regrade)
    console.log(
      `\nThe harness failed, so the pod, Postgres and tenants were kept. Re-grade without re-running Otto with:\n  ${result.regrade}`,
    );
}
await exitWith(results.length && results.every((result) => result.passed) ? 0 : 1);
