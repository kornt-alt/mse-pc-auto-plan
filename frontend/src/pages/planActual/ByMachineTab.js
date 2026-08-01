import React, { useState, useEffect, useCallback } from 'react';
import { Form, Button, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import { DateCell, stickyStyle, dateCellStyle, ROW_HEIGHT } from './matrixCells';

// MATRIX PRODUCTION DASHBOARD — port จาก tabs/dashboard_plan_actual_machine.dart
const DATE_COL_WIDTH = 150;

const FIXED_COLS = [
  ['No.', 0, 50],
  ['Machine', 50, 80],
  ['Batch', 130, 150],
  ['Description', 280, 150],
  ['Step', 430, 100],
  ['Qty.', 530, 80],
];

const trunc = (v) => Math.trunc(Number(v) || 0);

const ByMachineTab = () => {
  const [machines, setMachines] = useState([]);
  const [selectedMachine, setSelectedMachine] = useState('');
  const [rows, setRows] = useState([]);
  const [sortedDates, setSortedDates] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // FIX: ดึงจาก machine_config ผ่าน /production/machines (เดิม hardcode 8 ตัวฝั่ง Flutter)
    apiCall('/production/machines')
      .then((res) => setMachines(res.data || []))
      .catch(() => setMachines([]));
  }, []);

  // transform ตาม dart L80-187
  const fetchPlanVsActual = useCallback(async (machine) => {
    setLoading(true);
    try {
      const res = await apiCall(
        `/visualization/plan-vs-actual?machine=${encodeURIComponent(machine)}`
      );
      const grouped = {};
      const dateSet = new Set();

      for (const item of res.data || []) {
        const parentBatch = item.batch ?? '-';
        const subBatches = item.sub_batches ?? parentBatch;
        const step = String(item.step ?? '-');
        const datePlan = item.plan_detail?.date_plan ?? '';
        if (!datePlan || datePlan === '9999-12-31') continue;
        dateSet.add(datePlan);
        if (step.toUpperCase().includes('SETUP')) continue;

        const rowKey = `${item.machine}|${parentBatch}|${subBatches}|${step}`;
        const planQty = Number(item.plan_detail?.qty_plan) || 0;
        const actualOk = Number(item.actual_detail?.qty_ok) || 0;
        const actualNg = Number(item.actual_detail?.qty_ng) || 0;

        if (!grouped[rowKey]) {
          grouped[rowKey] = {
            machine: item.machine ?? '-',
            parent_batch: parentBatch,
            sub_batches: subBatches,
            description: item.description ?? '-',
            step,
            step_index: item.step_index ?? 999,
            order_qty: Number(item.order_qty) || 0,
            total_qty: 0,
            total_actual_ok: Number(item.total_historical_ok) || 0,
            dates: {},
          };
        }
        const row = grouped[rowKey];
        row.total_qty += planQty;
        if (!row.dates[datePlan]) row.dates[datePlan] = { plan: 0, ok: 0, ng: 0 };
        row.dates[datePlan].plan += planQty;
        row.dates[datePlan].ok += actualOk;
        row.dates[datePlan].ng += actualNg;
      }

      // sort: วันแรกสุดของ row → parent_batch → step_index → sub_batches (dart L154-174)
      const rowList = Object.values(grouped).map((r) => {
        const dateKeys = Object.keys(r.dates);
        return { ...r, earliest_date: dateKeys.length ? dateKeys.sort()[0] : '9999-12-31' };
      });
      rowList.sort(
        (a, b) =>
          a.earliest_date.localeCompare(b.earliest_date) ||
          a.parent_batch.localeCompare(b.parent_batch) ||
          a.step_index - b.step_index ||
          a.sub_batches.localeCompare(b.sub_batches)
      );
      setRows(rowList);
      setSortedDates([...dateSet].sort());
    } catch {
      setRows([]);
      setSortedDates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div>
      <div
        className="d-flex flex-wrap align-items-center gap-2 px-3 py-2"
        style={{ backgroundColor: '#263238', color: '#fff' }}
      >
        <strong>MATRIX PRODUCTION DASHBOARD</strong>
        <div className="ms-auto d-flex gap-2 align-items-center">
          <Form.Select
            size="sm"
            style={{ width: 240 }}
            value={selectedMachine}
            onChange={(e) => {
              const m = e.target.value;
              setSelectedMachine(m);
              if (m) fetchPlanVsActual(m);
            }}
          >
            <option value="">เลือกเครื่องจักร</option>
            {machines.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Form.Select>
          <Button
            variant="outline-light"
            size="sm"
            disabled={!selectedMachine}
            onClick={() => fetchPlanVsActual(selectedMachine)}
          >
            <i className="bi bi-arrow-clockwise" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {!selectedMachine ? (
        <div className="text-center text-muted py-5">
          <i className="bi bi-building-gear" style={{ fontSize: '4rem', opacity: 0.4 }} aria-hidden="true" />
          <div className="fw-bold mt-3">เลือกเครื่องจักรด้านบนเพื่อแสดงข้อมูล</div>
        </div>
      ) : loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center text-muted py-5" style={{ fontSize: 18 }}>
          ไม่มีข้อมูลแผนการผลิตของเครื่องจักรนี้
        </div>
      ) : (
        <div className="matrix-scroll bg-white" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: 'max-content' }}>
            <thead>
              <tr>
                {FIXED_COLS.map(([label, left, width]) => (
                  <th key={label} style={stickyStyle(left, width, { header: true })}>
                    {label}
                  </th>
                ))}
                {sortedDates.map((d) => (
                  <th key={d} style={dateCellStyle(DATE_COL_WIDTH, { header: true })}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const finalDisplayPlanQty = row.order_qty > 0 ? row.order_qty : row.total_qty;
                const pct =
                  finalDisplayPlanQty > 0
                    ? Math.min(row.total_actual_ok / finalDisplayPlanQty, 1)
                    : 0;
                return (
                  <tr key={idx} style={{ height: ROW_HEIGHT }}>
                    <td style={{ ...stickyStyle(0, 50), textAlign: 'center' }}>{idx + 1}</td>
                    <td style={{ ...stickyStyle(50, 80), fontWeight: 'bold', color: '#546E7A' }}>
                      {row.machine}
                    </td>
                    <td style={{ ...stickyStyle(130, 150), fontWeight: 'bold' }}>
                      {row.sub_batches ?? row.parent_batch}
                    </td>
                    <td style={stickyStyle(280, 150)}>{row.description}</td>
                    <td style={stickyStyle(430, 100)}>{row.step}</td>
                    <td style={stickyStyle(530, 80)}>
                      {/* Qty แบบง่าย: plan น้ำเงิน + actual เขียว + progress (dart L246-297) */}
                      <div style={{ color: '#1565C0', fontWeight: 'bold', fontSize: 15 }}>
                        {trunc(finalDisplayPlanQty)}
                      </div>
                      <div
                        style={{ height: 6, backgroundColor: '#1E88E5', borderRadius: 3, margin: '2px 0' }}
                      />
                      <div style={{ color: '#388E3C', fontWeight: 'bold', fontSize: 15 }}>
                        {trunc(row.total_actual_ok)}
                      </div>
                      <div style={{ height: 6, backgroundColor: '#e0e0e0', borderRadius: 3 }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${pct * 100}%`,
                            backgroundColor: '#4CAF50',
                            borderRadius: 3,
                          }}
                        />
                      </div>
                    </td>
                    {sortedDates.map((d) => (
                      <td key={d} style={dateCellStyle(DATE_COL_WIDTH)}>
                        <DateCell dayData={row.dates[d]} actPrefix="Act: " overLabel="(Over)" />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ByMachineTab;
