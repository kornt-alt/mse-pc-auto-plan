# -*- coding: utf-8 -*-
"""
dump_python_plan.py — run the OLD Python engine on a fixture and write the
expected output for the JS parity test.

Imports scheduler_core from OLD_BACKUP and replicates the pure pre-steps of
OLD_BACKUP/backend/services/logic.py verbatim (source lines noted inline),
substituting fixture rows for ORM rows and fixture.current_time for
datetime.now(). No DB access.

Usage:
  python dump_python_plan.py fixtures/baseline_run.json            -> fixtures/baseline_run.expected.json
  python dump_python_plan.py fixtures/*.json --service             (adds display data + shipment report)
"""
import argparse
import copy
import glob
import json
import os
import sys
from datetime import datetime

OLD_BACKEND = os.environ.get("OLD_BACKUP_BACKEND", r"D:\SCRIPT\WEB\MSE_AUTO_PLAN\OLD_BACKUP\backend")
sys.path.insert(0, OLD_BACKEND)

from scheduler_core import ConfigProcessor, SchedulerEngine, OrderManager  # noqa: E402


def run_fixture(fixture, with_service):
    current_time = datetime.fromisoformat(fixture["current_time"])
    is_replan = bool(fixture.get("is_replan"))

    # ---- logic.py L15-23: flat_routing / flat_machine -> ConfigProcessor ----
    flat_routing = [
        {"Model": r["model"], "FlowIndex": r["flow_index"], "StepIndex": r["step_index"],
         "StepName": r["step_name"], "SetupGroup": r["setup_group"]}
        for r in fixture["routing_config"]
    ]
    flat_machine = [
        {"Model": m["model"], "FlowIndex": m["flow_index"], "StepIndex": m["step_index"],
         "AlternativeIndex": m["alternative_index"], "Machine": m["machine"],
         "CycleTime": m["cycle_time"], "SetupTime": m["setup_time"], "JigID": m["jig_id"]}
        for m in fixture["machine_config"]
    ]
    cp = ConfigProcessor()
    routing = cp.process_routing(flat_routing)
    fixed_machine, cycle_time, setup_time = cp.process_unified_machine_config(flat_machine)

    # ---- logic.py L25-35: calendar (empty -> early return) ----
    calendar = {}
    for row in fixture["calendar"]:
        if row["machine"] not in calendar:
            calendar[row["machine"]] = {}
        calendar[row["machine"]][row["date"]] = row["available_time"]
    if not calendar:
        return {"early_return": "NO_CALENDAR"}

    # ---- logic.py L44-85: raw_orders build ----
    # (SQL WHERE filter was already applied by dump_fixture.py; the LEFT JOIN
    #  on product_master becomes a dict lookup here)
    pm_map = {p["model"]: p["setup_group"] for p in fixture["product_master"]}
    raw_orders = []
    today_str = current_time.strftime("%Y-%m-%d")  # L54 (datetime.now -> frozen)

    for row in fixture["orders"]:
        setup_group_val = pm_map.get(row["model"])
        w_flow_idx = row["wip_flow_index"] if row["wip_flow_index"] is not None else 0
        w_step_idx = row["wip_start_step_index"] if row["wip_start_step_index"] is not None else 0

        w_machine = row["wip_machine"] or ""

        plan_mode = row["plan_mode"] or "NEW"
        if not is_replan and plan_mode.upper() == "FIXED":  # L65
            plan_mode = "NEW"

        r_date = row["release_date"] or ""
        if r_date.lower() == "none":
            r_date = ""

        w_finish_date = row["wip_finish_date"] or ""
        if w_finish_date.lower() == "none":
            w_finish_date = ""

        if plan_mode == "NEW" and not r_date and not w_finish_date:  # L74-75
            r_date = today_str

        raw_orders.append({
            "Batch": row["batch"], "Model": row["model"], "dueDate": row["due_date"],
            "priority": row["priority"], "qty": row["qty"], "planMode": plan_mode,
            "WIP_FlowIndex": w_flow_idx, "WIP_StartStepIndex": w_step_idx,
            "WIP_FinishDate": w_finish_date, "WIP_Machine": w_machine,
            "planningMode": row["planning_mode"] or "forward", "releaseDate": r_date,
            "setup_group": setup_group_val if setup_group_val else row["model"],
        })

    # ---- logic.py L87-115: OrderManager pipeline + missing-routing reject ----
    om = OrderManager()
    parsed_orders = [om.parse_raw_input(o) for o in raw_orders]
    packed_orders = om.pack_orders(parsed_orders)
    final_orders = om.sort_for_scheduler(packed_orders)

    known_models = set(routing.keys())
    safe_orders = []
    rejected_orders = []
    missing_routing_map = {}
    for order in final_orders:
        model_name = order.get("Model")
        batch_id = order.get("Batch")
        if model_name in known_models:
            safe_orders.append(order)
        else:
            rejected_orders.append(f"{order.get('Batch')} ({model_name})")
            missing_routing_map[batch_id] = {
                "Batch": batch_id,
                "is_missing_routing": True,
                "original_batches": order.get("original_batches", []),
            }

    if not safe_orders:
        return {"early_return": "NO_SAFE_ORDERS", "missing_routing_map": missing_routing_map,
                "rejected_orders": rejected_orders}

    # ---- logic.py L117-126: existing_plan (replan only) ----
    existing_plan = []
    if is_replan:
        for r in fixture["schedule_results"]:
            existing_plan.append({
                "Batch": r["batch"], "Model": r["model"], "StepIndex": r["step_index"],
                "ProcessName": r["step"], "Machine": r["machine"], "DatePlan": r["date_plan"],
                "TimeUsedMin": r["time_used_min"], "QtyPlan": r["qty_plan"],
                "Type": "Setup" if r["is_setup"] else "Run",
            })

    # ---- logic.py L150-166: actuals_raw + actuals_mac_dict ----
    actuals_raw = {}
    actuals_mac_dict = {}
    for r in fixture["production_records"]:
        if r["batch"] not in actuals_raw:
            actuals_raw[r["batch"]] = {}
            actuals_mac_dict[r["batch"]] = {}
        if r["process_step"] not in actuals_raw[r["batch"]]:
            actuals_raw[r["batch"]][r["process_step"]] = {"ok": 0.0, "ng": 0.0}
        actuals_raw[r["batch"]][r["process_step"]]["ok"] += float(r["qty_ok"] or 0)
        actuals_raw[r["batch"]][r["process_step"]]["ng"] += float(r["qty_ng"] or 0)
        if (r["qty_ok"] + r["qty_ng"]) > 0:
            actuals_mac_dict[r["batch"]][r["process_step"]] = r["machine"]

    # ---- logic.py L168-204: fake-actual waterfall ----
    actuals_dict = {}
    for order in raw_orders:
        b_id = order.get("Batch")
        model_name = order.get("Model")
        order_qty = float(order.get("qty") or 0)

        if b_id not in actuals_dict:
            actuals_dict[b_id] = {}

        if model_name not in routing:
            continue

        raw_steps = [r for r in flat_routing if r["Model"] == model_name]
        steps = sorted(raw_steps, key=lambda x: x.get("FlowIndex", 0))  # quirk: FlowIndex, not StepIndex

        total_ng = sum([act["ng"] for act in actuals_raw.get(b_id, {}).values()])
        survivors = max(0.0, order_qty - total_ng)

        for step_info in steps:
            step_name = step_info.get("StepName")
            if "SETUP" in str(step_name).upper():
                continue
            act = actuals_raw.get(b_id, {}).get(step_name, {"ok": 0.0, "ng": 0.0})
            curr_total = act["ok"] + act["ng"]
            wip = max(0.0, survivors - curr_total)
            fake_actual = order_qty - wip
            actuals_dict[b_id][step_name] = fake_actual

    # ---- logic.py L209-213: closed_dict ----
    closed_dict = {}
    for s in fixture["batch_step_status"]:
        if not s["is_force_closed"]:
            continue
        if s["batch"] not in closed_dict:
            closed_dict[s["batch"]] = {}
        closed_dict[s["batch"]][s["step"]] = True

    # ---- logic.py L215-225: engine run ----
    engine = SchedulerEngine(calendar, routing, fixed_machine, cycle_time, setup_time)
    main_plan, status_map = engine.run(
        safe_orders,
        existing_plan=existing_plan,
        actuals=actuals_dict,
        actual_machines=actuals_mac_dict,
        closed_statuses=closed_dict,
        current_time=current_time,
    )

    expected = {
        "main_plan": copy.deepcopy(main_plan),  # engine order, before db_sort
        "total_plan_map": status_map,
        "missing_routing_map": missing_routing_map,
        "rejected_orders": rejected_orders,
    }

    if not with_service:
        return expected

    # =================== --service: display data + report ===================
    # ---- logic.py L227-252: op_start_db + db_sort ----
    op_start_db = {}
    for row in main_plan:
        m = row.get("machine", "")
        b = row.get("batch", "")
        s = row.get("stepIndex", 0)
        d = row.get("date", "")
        if d not in ["NO_CAPACITY", "OVERDUE", "9999-12-31", "CONFIG_ERROR"]:
            key = f"{m}|{b}|{s}"
            if key not in op_start_db or d < op_start_db[key]:
                op_start_db[key] = d

    def db_sort(row):
        m = row.get("machine", "")
        b = row.get("batch", "")
        s = int(row.get("stepIndex", 0))
        d = row.get("date", "")
        if d in ["NO_CAPACITY", "OVERDUE", "9999-12-31", "CONFIG_ERROR"]:
            return (m, "9999-12-31", 9999, b, s, 1, d)
        real_prio = float(status_map.get(b, {}).get("priority", 99))
        setup_val = 0 if row.get("isSetup", False) else 1
        start_date = op_start_db.get(f"{m}|{b}|{s}", "9999-12-31")
        return (m, start_date, real_prio, b, s, setup_val, d)

    main_plan.sort(key=db_sort)

    # ---- logic.py L259-400: display build (pack_progress_buffer allocator) ----
    final_display_data = []
    pack_progress_buffer = {}

    for row in main_plan:
        if row.get("date") in ["NO_CAPACITY", "OVERDUE", "9999-12-31", "CONFIG_ERROR"]:
            continue
        batch_id = row.get("batch")
        is_setup = row.get("isSetup", False)
        step_idx = row.get("stepIndex", 0)
        pack_key = f"{batch_id}|{step_idx}"

        order_info = status_map.get(batch_id, {})
        raw_sub_batches = order_info.get("original_batches", [])

        active_subs_str = str(row.get("sub_batches", ""))
        active_ids = [x.strip() for x in active_subs_str.split(",")] if active_subs_str else []

        sub_batches = []
        sub_list = []
        for s in raw_sub_batches:
            s_name = str(s.get("Batch") or s.get("batch") or s) if isinstance(s, dict) else str(s)
            if not active_ids or s_name in active_ids:
                sub_batches.append(s)
                sub_list.append(s_name)

        sub_list_str = ",".join(sub_list) if sub_list else ""

        if is_setup:
            final_display_data.append({
                "date": row["date"], "machine": row["machine"], "batch": batch_id,
                "step": row["step"], "qty": f"{int(row.get('timeUsed_min', 0))} min (Setup)",
                "timeUsed_min": row.get("timeUsed_min", 0), "isSetup": True,
                "step_index": step_idx, "parent_batch": batch_id,
                "_sort_batch": batch_id, "_sort_priority": 0,
                "_model": row.get("model"), "_raw_qty": 0.0, "_db_sub_batches": sub_list_str,
            })
        else:
            if sub_batches and len(sub_batches) > 0:
                if pack_key not in pack_progress_buffer:
                    sub_rem_list = []
                    for s in sub_batches:
                        s_name = str(s.get("Batch") or s.get("batch") or batch_id) if isinstance(s, dict) else str(s)
                        s_qty = float(s.get("qty", 0) if isinstance(s, dict) else 0)
                        s_actual = 0
                        for b_key, step_dict in actuals_dict.items():
                            if str(b_key).strip() == s_name.strip():
                                for st_key, act_val in step_dict.items():
                                    if str(st_key).strip() == str(row.get("step", "")).strip():
                                        s_actual += act_val
                        rem = max(0, s_qty - s_actual)
                        sub_rem_list.append(rem)
                    pack_progress_buffer[pack_key] = {
                        "current_sub_idx": 0, "subs": sub_batches,
                        "sub_remaining": sub_rem_list,
                    }
                tracker = pack_progress_buffer[pack_key]
                daily_qty_to_allocate = float(row.get("qty", 0))
                total_daily_time = float(row.get("timeUsed_min", 0))

                while daily_qty_to_allocate > 0.001 and tracker["current_sub_idx"] < len(tracker["subs"]):
                    idx = tracker["current_sub_idx"]
                    current_sub = tracker["subs"][idx]
                    sub_name = str(current_sub.get("Batch") or current_sub.get("batch") or batch_id) if isinstance(current_sub, dict) else str(current_sub)
                    needed = tracker["sub_remaining"][idx]
                    take = min(daily_qty_to_allocate, needed)

                    if take > 0.001:
                        time_share = 0
                        if float(row.get("qty", 0)) > 0:
                            time_share = (take / float(row.get("qty", 0))) * total_daily_time
                        final_display_data.append({
                            "date": row["date"], "machine": row["machine"], "batch": sub_name,
                            "step": row["step"], "qty": f"{int(take)} pcs",
                            "timeUsed_min": round(time_share, 2), "isSetup": False,
                            "step_index": step_idx, "parent_batch": batch_id,
                            "_sort_batch": batch_id, "_sort_priority": 1,
                            "_model": row.get("model"), "_raw_qty": take, "_db_sub_batches": sub_name,
                        })

                    tracker["sub_remaining"][idx] -= take
                    daily_qty_to_allocate -= take
                    if tracker["sub_remaining"][idx] <= 0.001:
                        tracker["current_sub_idx"] += 1
            else:
                row_qty = float(row.get("qty", 0))
                if row_qty > 0.001:
                    final_display_data.append({
                        "date": row["date"], "machine": row["machine"], "batch": batch_id,
                        "step": row["step"], "qty": f"{int(row_qty)} pcs",
                        "timeUsed_min": row.get("timeUsed_min", 0), "isSetup": False,
                        "step_index": step_idx, "parent_batch": batch_id,
                        "_sort_batch": batch_id, "_sort_priority": 1,
                        "_model": row.get("model"), "_raw_qty": row_qty, "_db_sub_batches": "",
                    })

    # ---- logic.py L402-406: custom_sort ----
    def custom_sort(x):
        setup_val = 0 if x.get("isSetup", False) else 1
        return (x.get("machine", ""), x.get("date", ""), setup_val)

    final_display_data.sort(key=custom_sort)

    # ---- logic.py L411-434: schedule_results rows (what would be persisted) ----
    schedule_rows = []
    for item in final_display_data:
        p_batch = item.get("parent_batch", "")
        order_info = status_map.get(p_batch, {})
        model_name = order_info.get("Model", "")
        raw_qty = 0.0
        if not item.get("isSetup", False):
            qty_str = str(item.get("qty", "0")).replace(" pcs", "").strip()
            try:
                raw_qty = float(qty_str)
            except Exception:
                raw_qty = 0.0
        schedule_rows.append({
            "batch": p_batch, "sub_batches": item.get("batch", ""), "model": model_name,
            "step": item.get("step", ""), "step_index": item.get("step_index", 0),
            "machine": item.get("machine", ""), "date_plan": item.get("date", ""),
            "time_used_min": float(item.get("timeUsed_min", 0)), "qty_plan": raw_qty,
            "is_setup": item.get("isSetup", False),
        })

    # ---- logic.py L438-446: cleaned_data + _META_CAPACITY_ rows ----
    cleaned_data = [{k: v for k, v in item.items() if not k.startswith("_")} for item in final_display_data]
    for m, dates_dict in calendar.items():
        for d, avail in dates_dict.items():
            cleaned_data.append({
                "date": d, "machine": m, "batch": "_META_CAPACITY_",
                "step": "META", "qty": "0 pcs", "timeUsed_min": 0,
                "isSetup": False, "step_index": -1, "parent_batch": "_META_CAPACITY_",
                "available_min": avail,
            })

    # ---- logic.py L448-486: shipment report ----
    shipment_report = []
    batch_finish_map = {}
    for row in main_plan:
        d = row.get("date")
        if d in ["NO_CAPACITY", "OVERDUE", "9999-12-31", "CONFIG_ERROR"]:
            continue
        b_id = row.get("batch")
        if b_id not in batch_finish_map:
            batch_finish_map[b_id] = d
        else:
            if d > batch_finish_map[b_id]:
                batch_finish_map[b_id] = d

    for b_id, info in status_map.items():
        if b_id not in [o["Batch"] for o in safe_orders]:
            continue
        sub_batches = info.get("original_batches", [])
        actual_finish = batch_finish_map.get(b_id, "-")

        def check_delay(due, finish):
            if finish == "-" or finish == "9999-12-31":
                return "Unknown"
            if finish > due:
                return "Yes"
            return "No"

        if sub_batches and len(sub_batches) > 0:
            for sub in sub_batches:
                sub_id = sub["batch"] if isinstance(sub, dict) else sub
                sub_qty = sub["qty"] if isinstance(sub, dict) else 0
                due_date = info.get("dueDate", "2099-12-31")
                shipment_report.append({
                    "Batch": sub_id, "Model": info.get("Model", "-"),
                    "Qty": sub_qty, "DueDate": due_date, "FinishDate": actual_finish,
                    "Delay": check_delay(due_date, actual_finish),
                })
        else:
            due_date = info.get("dueDate", "2099-12-31")
            shipment_report.append({
                "Batch": b_id, "Model": info.get("Model", "-"),
                "Qty": info.get("qty", 0), "DueDate": due_date, "FinishDate": actual_finish,
                "Delay": check_delay(due_date, actual_finish),
            })

    shipment_report.sort(key=lambda x: x["DueDate"])

    # ---- logic.py L488-499: message + response shape ----
    msg = "✅ จัดแผนสำเร็จ (Hybrid Pro Backend)"
    if rejected_orders:
        msg += f" (⚠️ ข้าม {len(rejected_orders)} รายการที่ Model ไม่ถูกต้อง)"

    expected["service"] = {
        "message": msg,
        "total_planned_steps": len(cleaned_data),
        "data": cleaned_data,
        "report": shipment_report,
        "schedule_rows": schedule_rows,
    }
    return expected


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fixtures", nargs="+", help="fixture .json path(s), globs ok")
    ap.add_argument("--service", action="store_true", help="also emit display data + shipment report")
    args = ap.parse_args()

    paths = []
    for p in args.fixtures:
        matches = glob.glob(p)
        paths.extend(matches if matches else [p])
    paths = [p for p in paths if not p.endswith(".expected.json")]

    for path in paths:
        with open(path, "r", encoding="utf-8") as f:
            fixture = json.load(f)
        expected = run_fixture(fixture, args.service)
        out_path = os.path.splitext(path)[0] + ".expected.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(expected, f, ensure_ascii=False, indent=1, default=str)
        n_plan = len(expected.get("main_plan", []))
        print(f"OK {out_path}: main_plan={n_plan} early_return={expected.get('early_return', '-')}")


if __name__ == "__main__":
    main()
