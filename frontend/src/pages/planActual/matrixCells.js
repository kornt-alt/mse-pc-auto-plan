import React from 'react';

// ส่วนแชร์ของ matrix Plan & Actual (port จาก dashboard_plan_actual_batch.dart /
// dashboard_plan_actual_machine.dart) — แต่ละแท็บถือ markup ตารางเอง

export const ROW_HEIGHT = 85;
export const HEADER_BG = '#ECEFF1'; // blueGrey[50]

// สไตล์ cell ตรึงซ้าย (แทน scroll-sync 3 ทางของ Flutter — FIX: ใช้ CSS sticky)
export const stickyStyle = (left, width, { header = false } = {}) => ({
  position: 'sticky',
  left,
  minWidth: width,
  maxWidth: width,
  backgroundColor: header ? HEADER_BG : '#fff',
  border: '1px solid #dee2e6',
  padding: '4px 6px',
  fontSize: 13,
  zIndex: header ? 4 : 2,
  ...(header ? { top: 0, fontWeight: 'bold', color: '#37474F' } : {}),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const dateCellStyle = (width, { header = false } = {}) => ({
  minWidth: width,
  maxWidth: width,
  border: '1px solid #dee2e6',
  padding: '4px 6px',
  textAlign: 'center',
  fontSize: 12,
  backgroundColor: header ? HEADER_BG : '#fff',
  ...(header
    ? { position: 'sticky', top: 0, zIndex: 3, fontWeight: 'bold', color: '#37474F' }
    : {}),
});

const trunc = (v) => Math.trunc(Number(v) || 0);

// Cell Plan/Actual ต่อวัน — ByBatch: actPrefix "Act : ", overLabel "(WIP/Over)"
//                           ByMachine: actPrefix "Act: ", overLabel "(Over)" (spacing ตามเดิม)
export const DateCell = ({ dayData, actPrefix, overLabel }) => {
  if (!dayData || !dayData.plan) return null;
  const plan = trunc(dayData.plan);
  const ok = trunc(dayData.ok);
  const ng = trunc(dayData.ng);
  const ngText = ng > 0 ? ` (NG: ${ng})` : '';
  const isOver = ok > plan;
  const okPct = plan > 0 ? Math.min(ok / plan, 1) : 0;
  const ngPct = plan > 0 ? Math.min(ng / plan, 1 - okPct) : 0;

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 'bold', color: '#455A64' }}>Plan : {plan}</div>
      <div style={{ height: 8, backgroundColor: '#1E88E5', borderRadius: 3, marginBottom: 3 }} />
      <div
        style={{
          fontSize: 11,
          fontWeight: 'bold',
          whiteSpace: 'nowrap',
          color: isOver ? '#EF6C00' : '#455A64',
        }}
      >
        {isOver ? `${actPrefix}${ok}${ngText} ${overLabel}` : `${actPrefix}${ok}${ngText} / ${plan}`}
      </div>
      <div style={{ display: 'flex', height: 8, backgroundColor: '#e0e0e0', borderRadius: 3 }}>
        <div style={{ flexGrow: okPct * 1000, backgroundColor: '#4CAF50', borderRadius: 3 }} />
        <div style={{ flexGrow: ngPct * 1000, backgroundColor: '#F44336' }} />
        <div style={{ flexGrow: Math.max(0, 1 - okPct - ngPct) * 1000 }} />
      </div>
    </div>
  );
};
