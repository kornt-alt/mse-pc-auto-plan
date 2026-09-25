import React from 'react';
import PropTypes from 'prop-types';

/**
 * แถบตัวเลขสรุปบนหัวหน้ารายงาน
 * items = [{ id, label, value, sub?, tone?: 'ok'|'warn'|'ng'|'info'|'muted', selectable? }]
 * onSelect(id) — ถ้าส่งมา การ์ดกดได้ (ใช้กรองตาราง) · activeId = การ์ดที่กำลังกรองอยู่
 */
const KpiStrip = ({ items, onSelect, activeId }) => (
  <div className="kpi-strip">
    {items.map((k) => {
      const clickable = typeof onSelect === 'function' && k.selectable !== false;
      const cls = `kpi-card kpi-${k.tone || 'muted'}${clickable ? ' kpi-clickable' : ''}${activeId === k.id ? ' kpi-active' : ''}`;
      const body = (
        <>
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value num">{k.value}</div>
          {k.sub && <div className="kpi-sub">{k.sub}</div>}
        </>
      );
      return clickable ? (
        <button
          key={k.id}
          type="button"
          className={cls}
          onClick={() => onSelect(k.id)}
          aria-pressed={activeId === k.id}
          title="กดเพื่อกรอง / กดซ้ำเพื่อยกเลิก"
        >
          {body}
        </button>
      ) : (
        <div key={k.id} className={cls}>{body}</div>
      );
    })}
  </div>
);

KpiStrip.propTypes = {
  items: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.node.isRequired,
    value: PropTypes.node,
    sub: PropTypes.node,
    tone: PropTypes.string,
    selectable: PropTypes.bool,
  })).isRequired,
  onSelect: PropTypes.func,
  activeId: PropTypes.string,
};

export default KpiStrip;
