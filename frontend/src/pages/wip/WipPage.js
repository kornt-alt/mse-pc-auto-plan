import React from 'react';
import { Tabs, Tab } from 'react-bootstrap';
import SearchTab from './SearchTab';
import SummaryTab from './SummaryTab';
import PageHeader from '../../components/shared/PageHeader';
import { todayBangkok } from '../../utils/dates';

// WIP (Work In Progress) — port จาก wip_main_screen.dart
// เปิดที่แท็บสรุปภาพรวมเป็นค่าเริ่มต้น (Flutter initialIndex: 1) — ย้ายมาเป็นแท็บแรก 2026-09-25
const WipPage = () => {
  const today = todayBangkok();
  return (
    <div className="container-fluid py-3">
      <PageHeader icon="bi-box-seam" title="WIP" subtitle="งานระหว่างผลิตคงค้างในแต่ละขั้นตอน" />
      <Tabs defaultActiveKey="summary" className="mb-3">
        <Tab eventKey="summary" title="สรุปภาพรวม">
          <SummaryTab today={today} />
        </Tab>
        <Tab eventKey="search" title="ค้นหารายการ" mountOnEnter>
          <SearchTab today={today} />
        </Tab>
      </Tabs>
    </div>
  );
};

export default WipPage;
