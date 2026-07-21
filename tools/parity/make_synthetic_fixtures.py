# -*- coding: utf-8 -*-
"""
make_synthetic_fixtures.py — generate the 10 parity fixtures synthetically
(same JSON shape as dump_fixture.py) for when the plant DB is unreachable.
Expected outputs still come from the real old engine via dump_python_plan.py.

Scenario coverage: baseline_run, baseline_replan (existing_plan + DatePlan
quirk), pack_boundary (29/31-day gaps), wip_forced_forward (actuals waterfall +
uploaded WIP), heat_logistic (Mon/Wed/Fri rounds), minor_setup_jig,
interruption_resetup, missing_routing, backward_mode (+Backward Failed),
multi_flow_sim.
"""
import json
import os
from datetime import date, timedelta

OUT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "backend", "scheduler", "__tests__", "fixtures",
)
CURRENT_TIME = "2026-07-17T10:00:00"  # Friday

MACHINES = ["MC-A", "MC-B", "MC-C", "OUTSOURCE-HEAT"]

ROUTING = [
    # MODEL-A: flow 1 — TURNING (MC-A | alt MC-B) -> MILLING (MC-C)
    {"model": "MODEL-A", "flow_index": 1, "step_index": 0, "step_name": "TURNING", "setup_group": "SG-ALPHA"},
    {"model": "MODEL-A", "flow_index": 1, "step_index": 1, "step_name": "MILLING", "setup_group": "SG-ALPHA"},
    # MODEL-HEAT: TURNING -> HEAT-TREATMENT (day-unit + deep plan) -> FINISH-MILL
    {"model": "MODEL-HEAT", "flow_index": 1, "step_index": 0, "step_name": "TURNING", "setup_group": "SG-HEAT"},
    {"model": "MODEL-HEAT", "flow_index": 1, "step_index": 1, "step_name": "HEAT-TREATMENT", "setup_group": "SG-HEAT"},
    {"model": "MODEL-HEAT", "flow_index": 1, "step_index": 2, "step_name": "FINISH-MILL", "setup_group": "SG-HEAT"},
    # MODEL-MULTI: 2 flows — flow 1 ช้า (MC-A), flow 2 เร็ว (MC-B)
    {"model": "MODEL-MULTI", "flow_index": 1, "step_index": 0, "step_name": "TURNING", "setup_group": "SG-MULTI"},
    {"model": "MODEL-MULTI", "flow_index": 1, "step_index": 1, "step_name": "MILLING", "setup_group": "SG-MULTI"},
    {"model": "MODEL-MULTI", "flow_index": 2, "step_index": 0, "step_name": "TURNING-ALT", "setup_group": "SG-MULTI"},
    {"model": "MODEL-MULTI", "flow_index": 2, "step_index": 1, "step_name": "MILLING", "setup_group": "SG-MULTI"},
    # MODEL-JIG / MODEL-JIG2: step เดียว เครื่องเดียวกัน jig เดียวกัน คนละ setup_group (กันโดน PACK รวม)
    {"model": "MODEL-JIG", "flow_index": 1, "step_index": 0, "step_name": "GRINDING", "setup_group": "SG-JIG1"},
    {"model": "MODEL-JIG2", "flow_index": 1, "step_index": 0, "step_name": "GRINDING", "setup_group": "SG-JIG2"},
    # MODEL-FIX: setup_group เดี่ยว (FIXED order ต้องไม่โดน PACK กลืน เพื่อ trigger path 'FIXED (Locked)')
    {"model": "MODEL-FIX", "flow_index": 1, "step_index": 0, "step_name": "TURNING-F", "setup_group": "SG-FIX"},
    {"model": "MODEL-FIX", "flow_index": 1, "step_index": 1, "step_name": "MILLING", "setup_group": "SG-FIX"},
]

MACHINE_CONFIG = [
    {"model": "MODEL-A", "flow_index": 1, "step_index": 0, "alternative_index": 0, "machine": "MC-A", "cycle_time": 2.0, "setup_time": 30.0, "jig_id": "J-A"},
    {"model": "MODEL-A", "flow_index": 1, "step_index": 0, "alternative_index": 1, "machine": "MC-B", "cycle_time": 2.5, "setup_time": 35.0, "jig_id": "J-A"},
    {"model": "MODEL-A", "flow_index": 1, "step_index": 1, "alternative_index": 0, "machine": "MC-C", "cycle_time": 1.0, "setup_time": 20.0, "jig_id": "-"},
    {"model": "MODEL-HEAT", "flow_index": 1, "step_index": 0, "alternative_index": 0, "machine": "MC-A", "cycle_time": 1.5, "setup_time": 25.0, "jig_id": "J-H"},
    {"model": "MODEL-HEAT", "flow_index": 1, "step_index": 1, "alternative_index": 0, "machine": "OUTSOURCE-HEAT", "cycle_time": 3.0, "setup_time": 0.0, "jig_id": "-"},
    {"model": "MODEL-HEAT", "flow_index": 1, "step_index": 2, "alternative_index": 0, "machine": "MC-C", "cycle_time": 1.0, "setup_time": 20.0, "jig_id": "-"},
    {"model": "MODEL-MULTI", "flow_index": 1, "step_index": 0, "alternative_index": 0, "machine": "MC-A", "cycle_time": 3.0, "setup_time": 30.0, "jig_id": "J-M"},
    {"model": "MODEL-MULTI", "flow_index": 1, "step_index": 1, "alternative_index": 0, "machine": "MC-C", "cycle_time": 1.0, "setup_time": 15.0, "jig_id": "-"},
    {"model": "MODEL-MULTI", "flow_index": 2, "step_index": 0, "alternative_index": 0, "machine": "MC-B", "cycle_time": 1.0, "setup_time": 20.0, "jig_id": "J-M2"},
    {"model": "MODEL-MULTI", "flow_index": 2, "step_index": 1, "alternative_index": 0, "machine": "MC-C", "cycle_time": 1.0, "setup_time": 15.0, "jig_id": "-"},
    {"model": "MODEL-JIG", "flow_index": 1, "step_index": 0, "alternative_index": 0, "machine": "MC-A", "cycle_time": 1.0, "setup_time": 60.0, "jig_id": "J-SHARE"},
    {"model": "MODEL-JIG2", "flow_index": 1, "step_index": 0, "alternative_index": 0, "machine": "MC-A", "cycle_time": 1.0, "setup_time": 60.0, "jig_id": "J-SHARE"},
    {"model": "MODEL-FIX", "flow_index": 1, "step_index": 0, "alternative_index": 0, "machine": "MC-B", "cycle_time": 2.0, "setup_time": 30.0, "jig_id": "J-F"},
    {"model": "MODEL-FIX", "flow_index": 1, "step_index": 1, "alternative_index": 0, "machine": "MC-C", "cycle_time": 1.0, "setup_time": 20.0, "jig_id": "-"},
]

PRODUCT_MASTER = [
    {"model": "MODEL-A", "setup_group": "SG-ALPHA"},
    {"model": "MODEL-HEAT", "setup_group": "SG-HEAT"},
    {"model": "MODEL-MULTI", "setup_group": None},  # fallback -> ชื่อ model
    {"model": "MODEL-JIG", "setup_group": "SG-JIG1"},
    {"model": "MODEL-JIG2", "setup_group": "SG-JIG2"},
    {"model": "MODEL-FIX", "setup_group": "SG-FIX"},
    # MODEL-GHOST ไม่มีทั้งใน product_master และ routing
]


def build_calendar(start="2026-07-17", end="2026-09-30", minutes=1240.0, overrides=None):
    rows = []
    d = date.fromisoformat(start)
    stop = date.fromisoformat(end)
    while d <= stop:
        avail = 0.0 if d.weekday() == 6 else minutes  # อาทิตย์หยุด
        for m in MACHINES:
            key = (m, d.isoformat())
            rows.append({
                "machine": m, "date": d.isoformat(),
                "available_time": overrides[key] if overrides and key in overrides else avail,
            })
        d += timedelta(days=1)
    return rows


def order(batch, model, due, prio, qty, **kw):
    row = {
        "batch": batch, "model": model, "due_date": due, "priority": prio, "qty": float(qty),
        "plan_mode": "NEW", "wip_flow_index": None, "wip_start_step_index": None,
        "wip_finish_date": None, "wip_machine": None, "planning_mode": "forward",
        "release_date": None,
    }
    row.update(kw)
    return row


def fixture(name, orders, is_replan=False, production_records=None, batch_step_status=None, schedule_results=None, calendar_overrides=None):
    return {
        "name": name,
        "current_time": CURRENT_TIME,
        "is_replan": is_replan,
        "routing_config": ROUTING,
        "machine_config": MACHINE_CONFIG,
        "calendar": build_calendar(overrides=calendar_overrides),
        "orders": orders,
        "product_master": PRODUCT_MASTER,
        "production_records": production_records or [],
        "batch_step_status": batch_step_status or [],
        "schedule_results": schedule_results or [],
    }


FIXTURES = [
    fixture("baseline_run", [
        # 001+002 setup_group เดียวกัน due ห่าง 10 วัน -> โดน PACK ด้วย
        order("2600000001", "MODEL-A", "2026-08-05", 1, 300),
        order("2600000002", "MODEL-A", "2026-08-15", 2, 500),
        order("2600000003", "MODEL-HEAT", "2026-08-20", 3, 100),
    ]),

    fixture("baseline_replan", [
        order("2600000001", "MODEL-A", "2026-08-05", 1, 300),
        order("2600000002", "MODEL-A", "2026-08-15", 2, 500),
        order("2600000003", "MODEL-HEAT", "2026-08-20", 3, 100),
        # quirk เดิม: FIXED ที่ setup_group ชนกับ order อื่น -> โดน PACK กลืน planMode หาย
        order("2600000004", "MODEL-A", "2026-08-10", 1, 200, plan_mode="FIXED"),
        # FIXED standalone (setup_group เดี่ยว) -> trigger 'FIXED (Locked)' + capacity re-add จริง
        order("2600000005", "MODEL-FIX", "2026-08-12", 1, 150, plan_mode="FIXED"),
    ], is_replan=True, schedule_results=[
        # แผนเดิมของ FIXED standalone 005 -> ต้องถูก lock กลับเข้า main_plan
        {"batch": "2600000005", "sub_batches": "2600000005", "model": "MODEL-FIX", "step": "SETUP-TURNING-F", "step_index": 0, "machine": "MC-B", "date_plan": "2026-07-20", "time_used_min": 30.0, "qty_plan": 0.0, "is_setup": True},
        {"batch": "2600000005", "sub_batches": "2600000005", "model": "MODEL-FIX", "step": "TURNING-F", "step_index": 0, "machine": "MC-B", "date_plan": "2026-07-20", "time_used_min": 300.0, "qty_plan": 150.0, "is_setup": False},
        {"batch": "2600000005", "sub_batches": "2600000005", "model": "MODEL-FIX", "step": "MILLING", "step_index": 1, "machine": "MC-C", "date_plan": "2026-07-21", "time_used_min": 150.0, "qty_plan": 150.0, "is_setup": False},
        # แผนเดิมของ FIXED order (date ISO -> quirk %d/%m/%Y parse ไม่ผ่าน คงเดิม)
        {"batch": "2600000004", "sub_batches": "2600000004", "model": "MODEL-A", "step": "SETUP-TURNING", "step_index": 0, "machine": "MC-A", "date_plan": "2026-07-21", "time_used_min": 30.0, "qty_plan": 0.0, "is_setup": True},
        {"batch": "2600000004", "sub_batches": "2600000004", "model": "MODEL-A", "step": "TURNING", "step_index": 0, "machine": "MC-A", "date_plan": "2026-07-21", "time_used_min": 400.0, "qty_plan": 200.0, "is_setup": False},
        # แถว dd/mm/yyyy -> quirk parse ผ่าน (reformat เป็น ISO)
        {"batch": "2600000004", "sub_batches": "2600000004", "model": "MODEL-A", "step": "MILLING", "step_index": 1, "machine": "MC-C", "date_plan": "22/07/2026", "time_used_min": 200.0, "qty_plan": 200.0, "is_setup": False},
        # แผนเดิมของ order ปกติ -> เข้า machine_memory (jig ล่าสุดต่อเครื่อง)
        {"batch": "2600000001", "sub_batches": "2600000001", "model": "MODEL-A", "step": "SETUP-TURNING", "step_index": 0, "machine": "MC-A", "date_plan": "2026-07-18", "time_used_min": 30.0, "qty_plan": 0.0, "is_setup": True},
        {"batch": "2600000001", "sub_batches": "2600000001", "model": "MODEL-A", "step": "TURNING", "step_index": 0, "machine": "MC-A", "date_plan": "2026-07-18", "time_used_min": 600.0, "qty_plan": 300.0, "is_setup": False},
    ]),

    fixture("pack_boundary", [
        # 29 วัน -> รวม PACK, +31 วันถัดไป -> แยก
        order("2600000301", "MODEL-A", "2026-07-25", 1, 100),
        order("2600000302", "MODEL-A", "2026-08-23", 1, 150),
        order("2600000303", "MODEL-A", "2026-09-23", 1, 200),
    ]),

    fixture("wip_forced_forward", [
        # มี actuals -> forced forward + lock เครื่อง + waterfall (มี NG)
        order("2600000401", "MODEL-A", "2026-08-10", 5, 200),
        # uploaded WIP: เริ่มที่ step 1 มี finish date + เครื่อง
        order("2600000402", "MODEL-A", "2026-08-12", 6, 100,
              wip_flow_index=1, wip_start_step_index=1,
              wip_finish_date="2026-07-20", wip_machine="MC-A"),
        order("2600000403", "MODEL-HEAT", "2026-08-25", 7, 80),
    ], production_records=[
        {"batch": "2600000401", "process_step": "TURNING", "machine": "MC-A", "qty_ok": 150.0, "qty_ng": 10.0},
        {"batch": "2600000401", "process_step": "TURNING", "machine": "MC-A", "qty_ok": 20.0, "qty_ng": 5.0},
    ], batch_step_status=[
        {"batch": "2600000401", "step": "TURNING", "is_force_closed": True},
    ]),

    fixture("heat_logistic", [
        order("2600000501", "MODEL-HEAT", "2026-08-25", 1, 200),
        order("2600000502", "MODEL-HEAT", "2026-08-28", 2, 150, planning_mode="backward"),
    ]),

    fixture("minor_setup_jig", [
        # คนละ model/setup_group แต่ machine+jig เดียวกัน -> ตัวที่สอง setup = min(40, 60)
        order("2600000601", "MODEL-JIG", "2026-08-05", 1, 300),
        order("2600000602", "MODEL-JIG2", "2026-08-10", 2, 400),
    ]),

    fixture("interruption_resetup", [
        # MC-A วันที่ 07-21 เหลือ 60 นาที (>0 แต่ < MIN_FRAGMENT 120) -> order ใหญ่โดนคั่นกลางรัน
        # 07-20 รันเต็ม -> ข้าม 07-21 (cap 60 > 0) -> 07-22 resume => checkInterruption -> setup ใหม่
        order("2600000701", "MODEL-JIG", "2026-08-05", 1, 2000, release_date="2026-07-20"),
        order("2600000702", "MODEL-JIG2", "2026-08-20", 2, 300, release_date="2026-07-27"),
    ], calendar_overrides={("MC-A", "2026-07-21"): 60.0}),

    fixture("missing_routing", [
        order("2600000801", "MODEL-GHOST", "2026-08-10", 1, 100),
        order("2600000802", "MODEL-A", "2026-08-15", 2, 200),
    ]),

    fixture("backward_mode", [
        # feasible backward
        order("2600000901", "MODEL-A", "2026-08-14", 1, 200, planning_mode="backward"),
        # due ใกล้เกิน + qty ใหญ่ (3060 นาที > capacity ก่อน due ~2300) -> Backward Failed
        order("2600000902", "MODEL-JIG", "2026-07-19", 2, 3000, planning_mode="backward"),
    ]),

    fixture("multi_flow_sim", [
        # flow 2 (MC-B ct 1.0) เร็วกว่า flow 1 (MC-A ct 3.0) -> flow-sim ต้องเลือก flow 2
        order("2600001001", "MODEL-MULTI", "2026-08-20", 1, 300),
        # โหลด MC-A เพิ่มให้ flow 1 ยิ่งช้า
        order("2600001002", "MODEL-A", "2026-08-10", 1, 400),
    ]),
]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for fx in FIXTURES:
        path = os.path.join(OUT_DIR, fx["name"] + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(fx, f, ensure_ascii=False, indent=1)
        print(f"OK {fx['name']}: orders={len(fx['orders'])}")


if __name__ == "__main__":
    main()
