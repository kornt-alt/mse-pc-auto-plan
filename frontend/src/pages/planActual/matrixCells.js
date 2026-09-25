import React from 'react';
import PropTypes from 'prop-types';
import { attainmentPct, attainmentTone } from './planActual';

// ช่อง Plan/Actual ต่อวันของ matrix By Batch / By Machine (แทน DateCell สองบรรทัดเดิมจาก Flutter —
// ปรับให้กะทัดรัดรอบปรับหน้ารายงาน 2026-09-25: แถวสูง 85 → ราว 40px จึงเห็นงานบนจอได้มากขึ้น)
// FIX (คงจากเดิม): คอลัมน์ซ้ายตรึงด้วย CSS sticky (.rpt-table .frozen) แทน scroll-sync 3 ทางของ Flutter
//
// แสดง "ok / plan" + NG (ถ้ามี) + แถบสี:
//   วันที่ผ่านมาแล้ว/วันนี้ = สีตาม % ทำได้ (ATTAINMENT_TONE) · วันอนาคต = สีน้ำเงิน (ยังไม่ถึงกำหนด)
const trunc = (v) => Math.trunc(Number(v) || 0);

export const PlanCell = ({ dayData, date, today }) => {
  if (!dayData || !dayData.plan) return null;
  const plan = trunc(dayData.plan);
  const ok = trunc(dayData.ok);
  const ng = trunc(dayData.ng);
  const due = date <= today;
  const pct = attainmentPct(plan, ok);
  const tone = due ? attainmentTone(pct) : 'info';
  const width = plan > 0 ? Math.min(ok / plan, 1) * 100 : 0;
  return (
    <div title={`${date}\nแผน ${plan} · ได้ ${ok}${ng ? ` · NG ${ng}` : ''}${pct != null ? ` (${pct}%)` : ''}`}>
      <div className="num">
        <span className={due && ok < plan ? 'text-danger fw-bold' : 'fw-bold'}>{ok}</span>
        <span className="text-muted">/{plan}</span>
        {ng > 0 && <span className="text-danger ms-1">NG {ng}</span>}
        {ok > plan && <span className="text-warning ms-1" title="ผลิตเกินแผนของวันนั้น (WIP/Over)">▲</span>}
      </div>
      <div className={`mini-bar bar-${tone === 'muted' ? 'info' : tone}`}>
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
};

PlanCell.propTypes = {
  dayData: PropTypes.shape({ plan: PropTypes.number, ok: PropTypes.number, ng: PropTypes.number }),
  date: PropTypes.string.isRequired,
  today: PropTypes.string.isRequired,
};

// ชุดคลาสของคอลัมน์วัน (เสาร์-อาทิตย์ / วันนี้)
export const dateColClass = (d, today, isWeekend) =>
  ['col-date', isWeekend(d) ? 'col-weekend' : '', d === today ? 'col-today' : ''].filter(Boolean).join(' ');
