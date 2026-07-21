# -*- coding: utf-8 -*-
"""
dump_fixture.py — dump raw rows from the real MSE DB into a parity fixture JSON.

Standalone (pyodbc only, no imports from OLD_BACKUP). The fixture is the shared
input for both engines:
  - tools/parity/dump_python_plan.py  (old Python engine -> <name>.expected.json)
  - backend/scheduler/__tests__/parity.test.js (new JS engine)

Note: the orders WHERE clause below replicates the SQL-side filter of
OLD_BACKUP/backend/services/logic.py L49-52 (is_deleted=0 AND plan_mode
<> 'COMPLETED' OR NULL, case-insensitivity comes from the DB collation) so both
consumers can skip filtering entirely.

Usage:
  python dump_fixture.py --out fixtures/baseline_run.json
  python dump_fixture.py --out fixtures/wip.json --batches 2600000001,2600000002
  python dump_fixture.py --out fixtures/baseline_replan.json --replan
"""
import argparse
import json
import os
from datetime import datetime

import pyodbc

BACKEND_ENV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend", ".env")


def load_env(path):
    """Minimal .env parser (strips matching quotes like dotenv does)."""
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            val = val.strip()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in "'\"":
                val = val[1:-1]
            env[key.strip()] = val
    return env


def fetch(cur, sql, params=()):
    cur.execute(sql, params)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output fixture .json path")
    ap.add_argument("--batches", default=None, help="comma-separated batch ids to trim the fixture to")
    ap.add_argument("--replan", action="store_true", help="mark fixture as is_replan (includes schedule_results as existing_plan)")
    ap.add_argument("--current-time", default=None, help="ISO datetime to freeze as current_time (default: now)")
    env = load_env(BACKEND_ENV)
    ap.add_argument("--server", default=os.environ.get("DB_SERVER", env.get("DB_SERVER", r"PLBSG04\SQLEXPRESS")))
    ap.add_argument("--database", default=os.environ.get("DB_NAME", env.get("DB_NAME", "MSE")))
    args = ap.parse_args()

    driver = env.get("DB_ODBC_DRIVER", "ODBC Driver 17 for SQL Server")
    conn_str = (
        f"DRIVER={{{driver}}};"
        f"SERVER={args.server};DATABASE={args.database};"
        "TrustServerCertificate=yes;"
    )
    if env.get("DB_AUTH", "windows").lower() == "sql":
        conn_str += f"UID={env.get('DB_USER', '')};PWD={env.get('DB_PASSWORD', '')};"
    else:
        conn_str += "Trusted_Connection=yes;"
    conn = pyodbc.connect(conn_str)
    cur = conn.cursor()

    order_where = "is_deleted = 0 AND (plan_mode <> 'COMPLETED' OR plan_mode IS NULL)"
    order_params = []
    batch_filter_sql = ""
    batches = None
    if args.batches:
        batches = [b.strip() for b in args.batches.split(",") if b.strip()]
        placeholders = ",".join("?" for _ in batches)
        batch_filter_sql = f" AND batch IN ({placeholders})"
        order_params = list(batches)

    orders = fetch(
        cur,
        "SELECT batch, model, due_date, priority, qty, plan_mode, "
        "wip_flow_index, wip_start_step_index, wip_finish_date, wip_machine, "
        "planning_mode, release_date "
        f"FROM orders WHERE {order_where}{batch_filter_sql} ORDER BY id",
        order_params,
    )

    routing = fetch(cur, "SELECT model, flow_index, step_index, step_name, setup_group FROM routing_config ORDER BY id")
    machine = fetch(
        cur,
        "SELECT model, flow_index, step_index, alternative_index, machine, cycle_time, setup_time, jig_id "
        "FROM machine_config ORDER BY id",
    )
    calendar = fetch(cur, "SELECT machine, date, available_time FROM calendar_config ORDER BY id")
    product_master = fetch(cur, "SELECT model, setup_group FROM product_master ORDER BY id")

    if batches:
        models = {o["model"] for o in orders}
        routing = [r for r in routing if r["model"] in models]
        machine = [m for m in machine if m["model"] in models]
        machines = {m["machine"] for m in machine if m["machine"]}
        calendar = [c for c in calendar if c["machine"] in machines]
        product_master = [p for p in product_master if p["model"] in models]

        placeholders = ",".join("?" for _ in batches)
        production_records = fetch(
            cur,
            "SELECT batch, process_step, machine, qty_ok, qty_ng "
            f"FROM production_records WHERE batch IN ({placeholders}) ORDER BY id",
            batches,
        )
        batch_step_status = fetch(
            cur,
            "SELECT batch, step, is_force_closed "
            f"FROM batch_step_status WHERE batch IN ({placeholders}) ORDER BY id",
            batches,
        )
        # NOTE: schedule_results.batch is the parent batch (may be PACK-*) —
        # a --batches trim can miss PACK parents; use full dumps for replan fixtures.
        schedule_results = fetch(
            cur,
            "SELECT batch, sub_batches, model, step, step_index, machine, date_plan, time_used_min, qty_plan, is_setup "
            f"FROM schedule_results WHERE batch IN ({placeholders}) ORDER BY id",
            batches,
        )
    else:
        production_records = fetch(cur, "SELECT batch, process_step, machine, qty_ok, qty_ng FROM production_records ORDER BY id")
        batch_step_status = fetch(cur, "SELECT batch, step, is_force_closed FROM batch_step_status ORDER BY id")
        schedule_results = fetch(
            cur,
            "SELECT batch, sub_batches, model, step, step_index, machine, date_plan, time_used_min, qty_plan, is_setup "
            "FROM schedule_results ORDER BY id",
        )

    conn.close()

    current_time = args.current_time or datetime.now().replace(microsecond=0).isoformat()

    fixture = {
        "name": os.path.splitext(os.path.basename(args.out))[0],
        "current_time": current_time,
        "is_replan": bool(args.replan),
        "routing_config": routing,
        "machine_config": machine,
        "calendar": calendar,
        "orders": orders,
        "product_master": product_master,
        "production_records": production_records,
        "batch_step_status": batch_step_status,
        "schedule_results": schedule_results,
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(fixture, f, ensure_ascii=False, indent=1, default=str)

    print(
        f"OK {args.out}: orders={len(orders)} routing={len(routing)} machine={len(machine)} "
        f"calendar={len(calendar)} prod_records={len(production_records)} "
        f"step_status={len(batch_step_status)} schedule_results={len(schedule_results)} "
        f"current_time={current_time} is_replan={fixture['is_replan']}"
    )


if __name__ == "__main__":
    main()
