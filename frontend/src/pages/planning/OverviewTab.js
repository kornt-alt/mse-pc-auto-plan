// Planing Chart — heat matrix (port 1:1 จาก overview_tab.dart)
// แถว = machine|batch|step, คอลัมน์ = วัน, header สีตาม booked/available
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import FilterBar from './FilterBar';
import { exportCsv } from '../../utils/csvExport';

const META = '_META_CAPACITY_';
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // จันทร์=index 0
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// สี Material เดียวกับ Flutter
const GREEN = { 100: '#c8e6c9', 300: '#81c784', 500: '#4caf50', 700: '#388e3c' };

// header cell: "DD-Mon(D)" + "W booked/avail" (overview_tab.dart L504-578)
const headerInfo = (d) => {
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) {
    return { label: d.length > 5 ? d.slice(5) : d, day: '', isSunday: false };
  }
  const weekday = (dt.getDay() + 6) % 7; // Dart weekday-1 (Mon=0)
  return {
    label: `${String(dt.getDate()).padStart(2, '0')}-${SHORT_MONTHS[dt.getMonth()]}`,
    day: DAY_LETTERS[weekday],
    isSunday: dt.getDay() === 0,
  };
};

// เรียงแถวแบบเดิม: วันเริ่มของ parent group -> parent -> step_index -> setup ก่อน -> batch
const makeRowSorter = (groupFirstDate) => (a, b) => {
  const pA = String(a.parent_batch ?? a.batch ?? '');
  const pB = String(b.parent_batch ?? b.batch ?? '');
  const dA = groupFirstDate[pA] ?? '9999-12-31';
  const dB = groupFirstDate[pB] ?? '9999-12-31';
  if (dA !== dB) return dA < dB ? -1 : 1;
  if (pA !== pB) return pA < pB ? -1 : 1;
  const sA = a.step_index ?? 999;
  const sB = b.step_index ?? 999;
  if (sA !== sB) return sA - sB;
  const setA = a.isSetup ?? false;
  const setB = b.isSetup ?? false;
  if (setA !== setB) return setA ? -1 : 1;
  const bA = String(a.batch ?? '');
  const bB = String(b.batch ?? '');
  return bA < bB ? -1 : bA > bB ? 1 : 0;
};

const cellValue = (row) =>
  row.isSetup === true
    ? `${parseInt(String(row.timeUsed_min).split('.')[0], 10)}m`
    : `${row.qty}`;

const OverviewTab = ({ planData }) => {
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [selectedBatch, setSelectedBatch] = useState(null);

  const realPlanData = useMemo(
    () => planData.filter((r) => r.batch !== META),
    [planData],
  );

  const { machineList, batchList } = useMemo(() => {
    const macs = new Set();
    const batches = new Set();
    for (const row of realPlanData) {
      if (row.machine != null) macs.add(String(row.machine));
      if (row.batch != null) batches.add(String(row.batch));
    }
    return { machineList: [...macs].sort(), batchList: [...batches].sort() };
  }, [realPlanData]);

  // ค่าเริ่มต้น: batch แรกสุดตามลำดับข้อมูลจริง (ไม่เรียง A-Z) — L168-181
  const firstBatch = useMemo(() => {
    for (const row of planData) {
      if (row.batch != null && row.batch !== META) return String(row.batch);
    }
    return null;
  }, [planData]);

  useEffect(() => {
    if (selectedBatch === null && firstBatch !== null) {
      setSelectedBatch(firstBatch);
      setSelectedMachine(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstBatch]);

  const handleReset = useCallback(() => {
    setSelectedMachine(null);
    setSelectedBatch(firstBatch);
  }, [firstBatch]);

  // capacity ต่อ machine|date จากแถว META (ไม่มี -> default 1240) — L252-263
  const machineAvailPerDay = useMemo(() => {
    const map = {};
    for (const row of planData) {
      const d = String(row.date ?? '');
      const m = String(row.machine ?? '');
      if (d && m) {
        const v = row.available_min != null ? parseFloat(row.available_min) : NaN;
        map[`${d}|${m}`] = Number.isFinite(v) ? v : 1240.0;
      }
    }
    return map;
  }, [planData]);

  const sortedDates = useMemo(() => {
    const set = new Set();
    for (const row of realPlanData) {
      if (row.date != null && String(row.date).includes('-')) set.add(String(row.date));
    }
    return [...set].sort();
  }, [realPlanData]);

  const groupFirstDate = useMemo(() => {
    const map = {};
    for (const row of realPlanData) {
      const p = String(row.parent_batch ?? row.batch ?? '');
      const d = String(row.date ?? '9999-12-31');
      if (!(p in map) || d < map[p]) map[p] = d;
    }
    return map;
  }, [realPlanData]);

  // filter ตามเงื่อนไขเดิม (batch จับผ่าน parent ของ batch ที่เลือก)
  const filterRows = useCallback(
    (rows) => {
      let filtered = rows;
      if (selectedMachine !== null) {
        filtered = filtered.filter((r) => String(r.machine ?? '') === selectedMachine);
      }
      if (selectedMachine === null && selectedBatch === null) filtered = [];
      if (selectedBatch !== null) {
        const target = realPlanData.find((r) => String(r.batch ?? '') === selectedBatch);
        const targetParent = target
          ? String(target.parent_batch ?? target.batch ?? '')
          : selectedBatch;
        filtered = filtered.filter(
          (r) => String(r.parent_batch ?? r.batch ?? '') === targetParent,
        );
      }
      return filtered;
    },
    [selectedMachine, selectedBatch, realPlanData],
  );

  const { rowKeysOrder, matrixMap, bookedMinsPerDate, activeMachines } = useMemo(() => {
    const filtered = [...filterRows(realPlanData)];

    const booked = {};
    const machines = new Set();
    for (const row of filtered) {
      const d = String(row.date ?? '');
      const m = String(row.machine ?? '');
      if (d && d.includes('-') && m) {
        const mins = parseFloat(row.timeUsed_min ?? 0) || 0;
        booked[d] = (booked[d] ?? 0) + mins;
        machines.add(m);
      }
    }

    filtered.sort(makeRowSorter(groupFirstDate));

    const matrix = {};
    const keys = [];
    for (const row of filtered) {
      const key = `${String(row.machine ?? '')}|${String(row.batch ?? '')}|${String(row.step ?? '')}`;
      if (!(key in matrix)) {
        matrix[key] = {
          _machine: String(row.machine ?? ''),
          _batch: String(row.batch ?? ''),
          _step: String(row.step ?? ''),
          _isSetup: row.isSetup ?? false,
        };
        keys.push(key);
      }
      matrix[key][String(row.date ?? '')] = cellValue(row);
    }
    return { rowKeysOrder: keys, matrixMap: matrix, bookedMinsPerDate: booked, activeMachines: machines };
  }, [filterRows, realPlanData, groupFirstDate]);

  const availableForDate = useCallback(
    (date) => {
      let total = 0;
      for (const m of activeMachines) total += machineAvailPerDay[`${date}|${m}`] ?? 0;
      return total;
    },
    [activeMachines, machineAvailPerDay],
  );

  // Export CSV pivot ตาม filter ปัจจุบัน (overview_tab.dart L57-148)
  const handleExport = () => {
    const filtered = [...filterRows(realPlanData)].sort(makeRowSorter(groupFirstDate));
    const matrix = {};
    const keys = [];
    for (const row of filtered) {
      const key = `${String(row.machine ?? '')}|${String(row.batch ?? '')}|${String(row.step ?? '')}`;
      if (!(key in matrix)) {
        matrix[key] = {
          _m: String(row.machine ?? ''),
          _b: String(row.batch ?? ''),
          _s: String(row.step ?? ''),
          _isS: row.isSetup ?? false,
        };
        keys.push(key);
      }
      matrix[key][String(row.date ?? '')] = cellValue(row);
    }
    const rows = keys.map((key) => {
      const data = matrix[key];
      return [
        data._m,
        data._b,
        data._isS === true ? `SETUP-${data._s}` : data._s, // quirk เดิม: เติม prefix ซ้ำ
        ...sortedDates.map((d) => data[d] ?? ''),
      ];
    });
    const today = new Date().toISOString().slice(0, 10);
    exportCsv(`Plan_Export_${today}.csv`, ['Machine', 'Batch', 'Process', ...sortedDates], rows);
  };

  if (planData.length === 0) {
    return <div className="text-center py-5 text-muted">ไม่มีข้อมูล</div>;
  }

  const nothingSelected = selectedMachine === null && selectedBatch === null;

  return (
    <div>
      <FilterBar
        machineList={machineList}
        batchList={batchList}
        selectedMachine={selectedMachine}
        selectedBatch={selectedBatch}
        onMachineChange={setSelectedMachine}
        onBatchChange={setSelectedBatch}
        onReset={handleReset}
        onExport={handleExport}
      />
      {nothingSelected ? (
        <div className="text-center py-5 fw-bold" style={{ color: '#546e7a' }}>
          กรุณาเลือกเครื่องจักร หรือ Batch ด้านบนเพื่อดูแผนการผลิต 🏭
        </div>
      ) : (
        <div className="planning-matrix-wrap">
          <table className="planning-matrix">
            <thead>
              <tr>
                <th className="frozen-0">Machine</th>
                <th className="frozen-1">Batch</th>
                <th className="frozen-2">Process</th>
                {sortedDates.map((d) => {
                  const { label, day, isSunday } = headerInfo(d);
                  const booked = bookedMinsPerDate[d] ?? 0;
                  const avail = availableForDate(d);
                  const pct = avail === 0 ? 0 : booked / avail;
                  let bg = '#fff';
                  let subColor = '#212121';
                  if (pct > 0 && pct <= 0.25) bg = GREEN[100];
                  else if (pct > 0.25 && pct <= 0.5) bg = GREEN[300];
                  else if (pct > 0.5 && pct <= 0.75) {
                    bg = GREEN[500];
                    subColor = '#fff';
                  } else if (pct > 0.75) {
                    bg = GREEN[700];
                    subColor = '#fff';
                  }
                  return (
                    <th key={d} className="date-col" style={{ background: bg }}>
                      <div style={{ color: isSunday ? '#d32f2f' : '#212121', fontSize: 12 }}>
                        {label}({day})
                      </div>
                      <div
                        style={{
                          fontSize: 9,
                          fontWeight: 500,
                          color: isSunday && pct === 0 ? '#e57373' : subColor,
                        }}
                      >
                        W {Math.round(booked)}/{Math.round(avail)}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rowKeysOrder.map((key) => {
                const data = matrixMap[key];
                const frozenCls = data._isSetup ? ' frozen-setup' : '';
                return (
                  <tr key={key}>
                    <td className={`frozen-0${frozenCls}`}>{data._machine}</td>
                    <td className={`frozen-1${frozenCls}`}>{data._batch}</td>
                    <td className={`frozen-2${frozenCls}`}>{data._step}</td>
                    {sortedDates.map((d) => {
                      const val = data[d];
                      return (
                        <td key={d} className="date-col">
                          {val != null && val !== '' && (
                            <span
                              className={`planning-chip ${data._isSetup ? 'planning-chip-setup' : 'planning-chip-run'}`}
                            >
                              {val}
                            </span>
                          )}
                        </td>
                      );
                    })}
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

export default OverviewTab;
