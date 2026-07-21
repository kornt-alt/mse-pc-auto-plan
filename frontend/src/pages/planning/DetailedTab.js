// Planing Table — ตารางแผนละเอียด (port 1:1 จาก detailed_tab.dart)
import React, { useState, useMemo, useCallback } from 'react';
import FilterBar from './FilterBar';
import { exportCsv } from '../../utils/csvExport';

const META = '_META_CAPACITY_';

const DetailedTab = ({ planData }) => {
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [selectedBatch, setSelectedBatch] = useState(null);

  const { machineList, batchList } = useMemo(() => {
    const macs = new Set();
    const batches = new Set();
    for (const row of planData) {
      if (row.batch === META) continue;
      if (row.machine != null) macs.add(String(row.machine));
      if (row.batch != null) batches.add(String(row.batch));
    }
    return { machineList: [...macs].sort(), batchList: [...batches].sort() };
  }, [planData]);

  // filter + smart sort (detailed_tab.dart L112-174)
  const displayData = useMemo(() => {
    let filtered = planData.filter((row) => row.batch !== META);

    if (selectedMachine !== null) {
      filtered = filtered.filter((row) => row.machine === selectedMachine);
    }
    if (selectedBatch !== null) {
      const target = planData.find((r) => r.batch === selectedBatch);
      const targetParent = target ? (target.parent_batch ?? target.batch) : selectedBatch;
      filtered = filtered.filter((row) => (row.parent_batch ?? row.batch) === targetParent);
    }

    const compareSetup = (a, b) => {
      const sA = a.isSetup ?? false;
      const sB = b.isSetup ?? false;
      if (sA !== sB) return sA ? -1 : 1;
      return 0;
    };

    filtered = [...filtered];
    filtered.sort((a, b) => {
      if (selectedBatch !== null && selectedBatch !== '') {
        // เลือก batch -> เรียงตามขั้นตอนงาน
        const stepCmp = (a.step_index ?? 999) - (b.step_index ?? 999);
        if (stepCmp !== 0) return stepCmp;
        return compareSetup(a, b);
      }
      const mA = a.machine ?? '';
      const mB = b.machine ?? '';
      if (mA !== mB) return mA < mB ? -1 : 1;
      const dA = a.date ?? '';
      const dB = b.date ?? '';
      if (dA !== dB) return dA < dB ? -1 : 1;
      const pA = a.parent_batch ?? a.batch ?? '';
      const pB = b.parent_batch ?? b.batch ?? '';
      if (pA !== pB) return pA < pB ? -1 : 1;
      const stepCmp = (a.step_index ?? 999) - (b.step_index ?? 999);
      if (stepCmp !== 0) return stepCmp;
      return compareSetup(a, b);
    });

    return filtered;
  }, [planData, selectedMachine, selectedBatch]);

  const handleExport = useCallback(() => {
    if (displayData.length === 0) return;
    const rows = displayData.map((row) => [
      row.date ?? '-',
      row.machine ?? '-',
      row.batch ?? '-',
      row.step ?? '-',
      row.qty ?? '0',
      row.isSetup === true ? 'Setup' : 'Run',
    ]);
    exportCsv(
      `schedule_detail_export_${Date.now()}.csv`,
      ['Date', 'Machine', 'Batch', 'Process', 'Qty / Time', 'Type'],
      rows,
    );
  }, [displayData]);

  if (planData.length === 0) {
    return <div className="text-center py-5 text-muted">ไม่มีข้อมูล (กด Start ที่มุมบน)</div>;
  }

  return (
    <div>
      <FilterBar
        machineList={machineList}
        batchList={batchList}
        selectedMachine={selectedMachine}
        selectedBatch={selectedBatch}
        onMachineChange={setSelectedMachine}
        onBatchChange={setSelectedBatch}
        onReset={() => {
          setSelectedMachine(null);
          setSelectedBatch(null);
        }}
        onExport={handleExport}
      />
      {displayData.length === 0 ? (
        <div className="text-center py-5 text-muted">ไม่พบข้อมูลตามเงื่อนไข</div>
      ) : (
        <div className="planning-table-wrap">
          <table className="planning-table">
            <thead>
              <tr>
                <th style={{ width: 100, minWidth: 100 }}>Date</th>
                <th style={{ width: 80, minWidth: 80 }}>Machine</th>
                <th style={{ width: 180, minWidth: 180 }}>Batch</th>
                <th style={{ width: 150, minWidth: 150 }}>Process</th>
                <th style={{ width: 120, minWidth: 120 }}>Qty / Time</th>
              </tr>
            </thead>
            <tbody>
              {displayData.map((row, i) => {
                const isSetup = row.isSetup ?? false;
                let bg = '#fff';
                if (isSetup) bg = '#fff3e0'; // orange.shade50
                else if (row.parent_batch !== row.batch) bg = '#e3f2fd'; // blue.shade50
                const qtyColor = isSetup ? '#ef6c00' : '#2e7d32'; // orange/green shade800
                return (
                  <tr key={i}>
                    <td style={{ background: bg }}>{row.date ?? '-'}</td>
                    <td style={{ background: bg }}>{row.machine ?? '-'}</td>
                    <td style={{ background: bg }}>{row.batch ?? '-'}</td>
                    <td style={{ background: bg }}>{row.step ?? '-'}</td>
                    <td style={{ background: bg, color: qtyColor }}>{String(row.qty)}</td>
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

export default DetailedTab;
