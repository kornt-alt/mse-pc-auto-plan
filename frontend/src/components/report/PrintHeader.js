import React from 'react';
import PropTypes from 'prop-types';
import { getCurrentUser } from '../../api/client';
import { nowBangkokLabel } from '../../utils/dates';

/**
 * หัวกระดาษรายงาน — บนจอซ่อน (.print-only) แสดงเฉพาะตอนพิมพ์
 * ใส่ไว้ในแต่ละแท็บ/หน้า เพื่อให้หัวกระดาษบอกว่าพิมพ์รายงานอะไร ด้วยเงื่อนไขไหน
 */
const PrintHeader = ({ title, filters, asOf }) => {
  const u = getCurrentUser();
  const who = u.full_name || u.username || '';
  return (
    <div className="print-only print-header">
      <div className="print-header__title">MSE Auto Plan — {title}</div>
      <div className="print-header__meta">
        {filters && <span>เงื่อนไข: {filters}</span>}
        {asOf && <span>ข้อมูล ณ {asOf}</span>}
        <span>พิมพ์เมื่อ {nowBangkokLabel()}{who ? ` โดย ${who}` : ''}</span>
      </div>
    </div>
  );
};

PrintHeader.propTypes = {
  title: PropTypes.node.isRequired,
  filters: PropTypes.node,
  asOf: PropTypes.node,
};

export default PrintHeader;
