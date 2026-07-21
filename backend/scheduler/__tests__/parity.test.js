// Parity test: JS pipeline ทั้งเส้น (pre-steps + engine) vs Python engine เดิม
// fixtures/<name>.json = input ดิบ (dump จาก DB หรือสังเคราะห์)
// fixtures/<name>.expected.json = output จาก tools/parity/dump_python_plan.py
// pipeline ตรงนี้ต้อง mirror dump_python_plan.py ทุกขั้น
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { assertDeepMatch } = require('./helpers/deepCompare');
const { processRouting, processUnifiedMachineConfig } = require('../configProcessor');
const { OrderManager } = require('../orderManager');
const { SchedulerEngine } = require('../engine');
const pb = require('../planBuilder');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

const fixtureFiles = fs.existsSync(FIXTURE_DIR)
  ? fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.expected.json'))
  : [];

test('มี parity fixtures ครบ', () => {
  assert.ok(fixtureFiles.length >= 10, `พบ fixture แค่ ${fixtureFiles.length} ชุด`);
});

for (const file of fixtureFiles) {
  const name = file.replace(/\.json$/, '');

  test(`parity: ${name}`, () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
    const expected = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, `${name}.expected.json`), 'utf8'),
    );

    // ---- mirror dump_python_plan.py: config ----
    const flatRouting = fixture.routing_config.map((r) => ({
      Model: r.model, FlowIndex: r.flow_index, StepIndex: r.step_index,
      StepName: r.step_name, SetupGroup: r.setup_group,
    }));
    const flatMachine = fixture.machine_config.map((m) => ({
      Model: m.model, FlowIndex: m.flow_index, StepIndex: m.step_index,
      AlternativeIndex: m.alternative_index, Machine: m.machine,
      CycleTime: m.cycle_time, SetupTime: m.setup_time, JigID: m.jig_id,
    }));
    const routing = processRouting(flatRouting);
    const { fixedMachine, cycleTime, setupConfig } = processUnifiedMachineConfig(flatMachine);

    // ---- calendar ----
    const calendar = {};
    for (const row of fixture.calendar) {
      if (!(row.machine in calendar)) calendar[row.machine] = {};
      calendar[row.machine][row.date] = row.available_time;
    }
    if (Object.keys(calendar).length === 0) {
      assert.equal(expected.early_return, 'NO_CALENDAR');
      return;
    }

    // fixture.current_time = เวลากำแพง (wall time) กรุงเทพ — convention เดียวกับ nowBangkok()
    const currentTime = new Date(`${fixture.current_time}Z`);
    const todayStr = fixture.current_time.slice(0, 10);

    // ---- pre-steps (planBuilder = port ของ logic.py) ----
    const pmMap = {};
    for (const p of fixture.product_master) pmMap[p.model] = p.setup_group;

    const rawOrders = pb.buildRawOrders(fixture.orders, pmMap, todayStr, !!fixture.is_replan);

    const om = new OrderManager();
    const parsed = rawOrders.map((o) => om.parseRawInput(o));
    const packed = om.packOrders(parsed);
    const finalOrders = om.sortForScheduler(packed);

    const { safeOrders, rejectedOrders, missingRoutingMap } = pb.rejectMissingRouting(finalOrders, routing);
    if (safeOrders.length === 0) {
      assert.equal(expected.early_return, 'NO_SAFE_ORDERS');
      assertDeepMatch(missingRoutingMap, expected.missing_routing_map, `${name}.missing_routing_map`);
      assertDeepMatch(rejectedOrders, expected.rejected_orders, `${name}.rejected_orders`);
      return;
    }

    const existingPlan = fixture.is_replan ? pb.buildExistingPlan(fixture.schedule_results) : [];
    const { actualsRaw, actualMachines } = pb.buildActuals(fixture.production_records);
    const actualsDict = pb.buildFakeActuals(rawOrders, routing, flatRouting, actualsRaw);
    const closedDict = pb.buildClosedDict(fixture.batch_step_status);

    // ---- engine ----
    const engine = new SchedulerEngine(calendar, routing, fixedMachine, cycleTime, setupConfig);
    const { mainPlan, totalPlanMap } = engine.run(
      safeOrders, existingPlan, actualsDict, actualMachines, closedDict, currentTime,
    );

    assertDeepMatch(mainPlan, expected.main_plan, `${name}.main_plan`);
    assertDeepMatch(Object.fromEntries(totalPlanMap), expected.total_plan_map, `${name}.total_plan_map`);
    assertDeepMatch(missingRoutingMap, expected.missing_routing_map, `${name}.missing_routing_map`);
    assertDeepMatch(rejectedOrders, expected.rejected_orders, `${name}.rejected_orders`);

    // ---- service-level (expected สร้างด้วย dump_python_plan.py --service) ----
    if (expected.service) {
      pb.sortMainPlanForDb(mainPlan, totalPlanMap); // mutate หลังเทียบ engine-level แล้วเท่านั้น
      const display = pb.buildDisplayRows(mainPlan, totalPlanMap, actualsDict);
      const scheduleRows = pb.toScheduleResultRows(display, totalPlanMap);
      const cleaned = pb.cleanDisplayData(display, calendar);
      const report = pb.buildShipmentReport(mainPlan, totalPlanMap, safeOrders);

      let msg = '✅ จัดแผนสำเร็จ (Hybrid Pro Backend)';
      if (rejectedOrders.length > 0) {
        msg += ` (⚠️ ข้าม ${rejectedOrders.length} รายการที่ Model ไม่ถูกต้อง)`;
      }

      assertDeepMatch(cleaned, expected.service.data, `${name}.service.data`);
      assertDeepMatch(report, expected.service.report, `${name}.service.report`);
      assertDeepMatch(scheduleRows, expected.service.schedule_rows, `${name}.service.schedule_rows`);
      assert.equal(msg, expected.service.message, `${name}.service.message`);
      assert.equal(cleaned.length, expected.service.total_planned_steps, `${name}.service.total_planned_steps`);
    }
  });
}
