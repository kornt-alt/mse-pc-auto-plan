import React, { useState, useEffect, useCallback } from 'react';
import { Form, Button, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import { DateCell, stickyStyle, dateCellStyle, ROW_HEIGHT } from './matrixCells';

// ORDER TRACKING MATRIX — port จาก tabs/dashboard_plan_actual_batch.dart
const DATE_COL_WIDTH = 130;

// คอลัมน์ตรึงซ้าย: [label, left offset, width]
const FIXED_COLS = [
  ['No.', 0, 50],
  ['Batch', 50, 150],
  ['Model', 200, 100],
  ['Description', 300, 150],
  ['Step', 450, 100],
  ['Machine', 550, 80],
  ['Qty.', 630, 100],
];

const trunc = (v) => Math.trunc(Number(v) || 0);

const ByBatchTab = () => {
  const [batchList, setBatchList] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [rows, setRows] = useState([]);
  const [sortedDates, setSortedDates] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchBatchList = useCallback(async () => {
    try {
      const orders = await apiCall('/orders');
      setBatchList([...new Set(orders.map((o) => String(o.batch)))].sort());
    } catch {
      setBatchList([]);
    }
  }, []);

  useEffect(() => {
    fetchBatchList();
  }, [fetchBatchList]);

  // transform ตาม dart L94-181
  const fetchPlanVsActual = useCallback(async (batch) => {
    setLoading(true);
    try {
      const res = await apiCall(
        `/visualization/plan-vs-actual?batch=${encodeURIComponent(batch)}`
      );
      const grouped = {};
      const dateSet = new Set();
      const earliestDateMap = {}; // ต่อ sub_batch

      for (const item of res.data || []) {
        const subBatches = item.sub_batches ?? item.batch ?? '-';
        const step = String(item.step ?? '-');
        const machine = String(item.machine ?? '-');
        const datePlan = item.plan_detail?.date_plan ?? '';
        if (!datePlan || datePlan === '9999-12-31') continue;

        // เก็บวันที่ + earliest ก่อน skip SETUP — SETUP ยังสร้างคอลัมน์วัน (ตามเดิม)
        dateSet.add(datePlan);
        if (!earliestDateMap[subBatches] || datePlan < earliestDateMap[subBatches]) {
          earliestDateMap[subBatches] = datePlan;
        }
        if (step.toUpperCase().includes('SETUP')) continue;

        const rowKey = `${subBatches}|${step}|${machine}`;
        const planQty = Number(item.plan_detail?.qty_plan) || 0;
        const actualOk = Number(item.actual_detail?.qty_ok) || 0;
        const actualNg = Number(item.actual_detail?.qty_ng) || 0;
        // quirk เดิม: total_historical_ng ไม่เคยถูกส่งจาก backend → 0 เสมอ → fallback รวม ng รายวัน
        const totalHistoricalNg = Number(item.total_historical_ng ?? 0);

        if (!grouped[rowKey]) {
          grouped[rowKey] = {
            batch: subBatches,
            model: item.model ?? '-',
            description: item.description ?? '-',
            step,
            machine,
            step_index: item.step_index ?? 999,
            order_qty: Number(item.order_qty) || 0,
            total_qty: 0,
            total_actual_ok: Number(item.total_historical_ok) || 0,
            total_actual_ng: totalHistoricalNg,
            dates: {},
          };
        }
        const row = grouped[rowKey];
        row.total_qty += planQty;
        if (totalHistoricalNg === 0) row.total_actual_ng += actualNg;
        if (!row.dates[datePlan]) row.dates[datePlan] = { plan: 0, ok: 0, ng: 0 };
        row.dates[datePlan].plan += planQty;
        row.dates[datePlan].ok += actualOk;
        row.dates[datePlan].ng += actualNg;
      }

      const rowList = Object.values(grouped).map((r) => ({
        ...r,
        step_earliest_date: earliestDateMap[r.batch] ?? '9999-12-31',
      }));
      rowList.sort(
        (a, b) =>
          a.step_index - b.step_index ||
          a.step_earliest_date.localeCompare(b.step_earliest_date) ||
          a.step.localeCompare(b.step)
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

  const handleSelect = (value) => {
    setInputValue(value);
    if (batchList.includes(value)) {
      setSelectedBatch(value);
      fetchPlanVsActual(value);
    }
  };

  return (
    <div>
      <div
        className="d-flex flex-wrap align-items-center gap-2 px-3 py-2"
        style={{ backgroundColor: '#263238', color: '#fff' }}
      >
        <strong>ORDER TRACKING MATRIX</strong>
        <div className="ms-auto d-flex gap-2 align-items-center">
          <Form.Control
            size="sm"
            style={{ width: 300 }}
            list="pa-batch-options"
            placeholder="พิมพ์เลข Batch เพื่อค้นหา..."
            value={inputValue}
            onChange={(e) => handleSelect(e.target.value)}
          />
          <datalist id="pa-batch-options">
            {batchList.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          <Button
            variant="outline-light"
            size="sm"
            disabled={!selectedBatch}
            onClick={() => {
              fetchBatchList();
              fetchPlanVsActual(selectedBatch);
            }}
          >
            <i className="bi bi-arrow-clockwise" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {!selectedBatch ? (
        <div className="text-center text-muted py-5">
          <i className="bi bi-signpost-split" style={{ fontSize: '4rem', opacity: 0.4 }} aria-hidden="true" />
          <div className="fw-bold mt-3">พิมพ์ค้นหา Batch ด้านบนเพื่อดูเส้นทางการผลิต</div>
        </div>
      ) : loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center text-muted py-5" style={{ fontSize: 18 }}>
          ไม่พบข้อมูลแผนการผลิตของ Batch นี้
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
                return (
                  <tr key={idx} style={{ height: ROW_HEIGHT }}>
                    <td style={{ ...stickyStyle(0, 50), textAlign: 'center' }}>{idx + 1}</td>
                    <td style={{ ...stickyStyle(50, 150), fontWeight: 'bold' }}>{row.batch}</td>
                    <td style={stickyStyle(200, 100)}>{row.model}</td>
                    <td style={stickyStyle(300, 150)}>{row.description}</td>
                    <td style={stickyStyle(450, 100)}>{row.step}</td>
                    <td style={{ ...stickyStyle(550, 80), fontWeight: 'bold', color: '#546E7A' }}>
                      {row.machine}
                    </td>
                    <td style={stickyStyle(630, 100)}>
                      {/* Qty 3 บรรทัด: Lot / In / Out (dart L190-240) */}
                      <div style={{ fontSize: 12, color: '#1976D2' }}>
                        <i className="bi bi-box-seam me-1" aria-hidden="true" />
                        Lot: {trunc(finalDisplayPlanQty)}
                      </div>
                      <div style={{ fontSize: 12, color: '#212121' }}>
                        <i className="bi bi-box-arrow-in-right me-1" aria-hidden="true" />
                        In: {trunc(row.total_actual_ok + row.total_actual_ng)}
                      </div>
                      <div style={{ fontSize: 12, color: '#388E3C' }}>
                        <i className="bi bi-check-circle me-1" aria-hidden="true" />
                        Out: {trunc(row.total_actual_ok)}
                      </div>
                    </td>
                    {sortedDates.map((d) => (
                      <td key={d} style={dateCellStyle(DATE_COL_WIDTH)}>
                        <DateCell
                          dayData={row.dates[d]}
                          actPrefix="Act : "
                          overLabel="(WIP/Over)"
                        />
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

export default ByBatchTab;
