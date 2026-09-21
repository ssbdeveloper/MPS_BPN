import { describe, expect, it } from 'vitest';
import {
  BLASTING_AREA,
  bpKindOf,
  bpSlotGroups,
  buildZoneOccupancy,
  rangeProgress,
  zoneSelectionGroups,
  groupAreaProjects,
  hashProjectName,
  projectColor,
  projectKeyOf,
  PROJECT_COLORS,
  shortProjectName,
  zoneOverlaps,
  zoneUsage,
} from './constants';

// Baris jadwal gaya GET /ms-project/bay-schedules. Satu baris = satu task; helper
// di sini bekerja pada baris TINGKAT-RESERVASI, jadi tiap reservasi cukup satu baris.
const row = (over = {}) => ({
  schedule_id: 's1',
  schedule_group_id: 'g1',
  booking_type: 'ORDER',
  order_no: 'PO-100',
  project_id: null,
  project_name: 'MPS - 8x MANHAUL 51 SEAT SDO - CJ-rev7',
  purpose: null,
  bay_codes: ['A38E'],
  start_date: '2026-08-18',
  end_date: '2026-09-28',
  status: 'ACTIVE',
  ...over,
});

describe('projectKeyOf', () => {
  it('memakai project_id sebagai kunci utama', () => {
    expect(projectKeyOf(row({ project_id: 'p-1' }))).toBe('pid:p-1');
  });

  it('jatuh ke project_name kalau project_id kosong', () => {
    expect(projectKeyOf(row())).toBe('name:MPS - 8x MANHAUL 51 SEAT SDO - CJ-rev7');
  });

  it('memakai purpose untuk booking non-job, bukan project_name', () => {
    const nonJob = row({
      booking_type: 'OTHER',
      order_no: null,
      purpose: 'PAINTING ROOM',
      project_name: 'PAINTING ROOM',
    });
    expect(projectKeyOf(nonJob)).toBe('nj:PAINTING ROOM');
  });

  it('mengembalikan kunci kosong kalau tidak ada penanda sama sekali', () => {
    expect(projectKeyOf(row({ project_name: null, order_no: null, purpose: null }))).toBe('');
  });
});

describe('groupAreaProjects', () => {
  it('menggabungkan beberapa order satu project jadi satu group', () => {
    const groups = groupAreaProjects([
      row({ schedule_id: 's1', order_no: 'PO-1', bay_codes: ['A38E'] }),
      row({ schedule_id: 's2', order_no: 'PO-2', bay_codes: ['A37E'] }),
      row({ schedule_id: 's3', order_no: 'PO-2', bay_codes: ['A36E'] }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].orders).toBe(2);          // PO-2 dihitung SEKALI walau 2 bay
    expect(groups[0].reservations).toBe(3);
    expect(groups[0].bays).toEqual(['A36E', 'A37E', 'A38E']);
    expect(groups[0].nonJob).toBe(false);
  });

  it('menggabungkan rentang tanggal seluruh booking project', () => {
    const groups = groupAreaProjects([
      row({ schedule_id: 's1', order_no: 'PO-1', start_date: '2026-08-18', end_date: '2026-09-01' }),
      row({ schedule_id: 's2', order_no: 'PO-2', start_date: '2026-07-21', end_date: '2026-09-28' }),
    ]);

    expect(groups[0].start_date).toBe('2026-07-21');
    expect(groups[0].end_date).toBe('2026-09-28');
  });

  it('memisahkan booking non-job sebagai group tersendiri', () => {
    const groups = groupAreaProjects([
      row({ schedule_id: 's1', order_no: 'PO-1' }),
      row({
        schedule_id: 's2',
        schedule_group_id: 'g2',
        booking_type: 'OTHER',
        order_no: null,
        purpose: 'JIG MAIN RUNNER',
        project_name: 'JIG MAIN RUNNER',
        bay_codes: ['A13C'],
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.filter((g) => g.nonJob)).toHaveLength(1);
    expect(groups[groups.length - 1].nonJob).toBe(true);   // non-job selalu di bawah
  });

  it('membuang reservasi CANCELLED dari hitungan', () => {
    const groups = groupAreaProjects([
      row({ schedule_id: 's1', order_no: 'PO-1' }),
      row({ schedule_id: 's2', order_no: 'PO-1', status: 'CANCELLED' }),
    ]);

    expect(groups[0].reservations).toBe(1);
  });

  it('menghasilkan dua group untuk dua project_id berbeda walau nama sama', () => {
    const groups = groupAreaProjects([
      row({ schedule_id: 's1', order_no: 'PO-1', project_id: 'p-1' }),
      row({ schedule_id: 's2', order_no: 'PO-2', project_id: 'p-2' }),
    ]);

    expect(groups).toHaveLength(2);
  });
});

describe('buildZoneOccupancy', () => {
  const groupsFor = (rows) => groupAreaProjects(rows);

  it('memisahkan zona EDGE dan CENTER pada bay yang sama', () => {
    const occupancy = buildZoneOccupancy('AREA-01', groupsFor([
      row({ project_id: 'p-1', order_no: 'PO-1', bay_codes: ['A38E'] }),
      row({ project_id: 'p-2', order_no: 'PO-2', bay_codes: ['A38C'] }),
    ]));

    expect(occupancy.zoned).toBe(true);
    expect(occupancy.byBay.A38.EDGE).toHaveLength(1);
    expect(occupancy.byBay.A38.CENTER).toHaveLength(1);
    expect(zoneOverlaps(occupancy)).toHaveLength(0);
  });

  it('mendeteksi dua project pada satu zona yang sama sebagai overlap', () => {
    const occupancy = buildZoneOccupancy('AREA-01', groupsFor([
      row({ schedule_id: 's1', project_id: 'p-1', order_no: 'PO-1', bay_codes: ['A38E'] }),
      row({ schedule_id: 's2', project_id: 'p-2', order_no: 'PO-2', bay_codes: ['A38E'] }),
    ]));

    const overlaps = zoneOverlaps(occupancy);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ bay: 'A38', zone: 'EDGE' });
    expect(overlaps[0].groups).toHaveLength(2);   // KEDUA reservasi tetap tersimpan
  });

  it('tidak membuang reservasi kedua pada satu bay (regresi: satu sel satu reservasi)', () => {
    const occupancy = buildZoneOccupancy('AREA-01', groupsFor([
      row({ schedule_id: 's1', project_id: 'p-1', order_no: 'PO-1', bay_codes: ['A38E'] }),
      row({ schedule_id: 's2', project_id: 'p-2', order_no: 'PO-2', bay_codes: ['A38E'] }),
    ]));

    expect(occupancy.byBay.A38.EDGE).toHaveLength(2);
  });

  it('menempatkan reservasi tanpa sufiks zona di SELURUH bay', () => {
    const occupancy = buildZoneOccupancy('AREA-01', groupsFor([
      row({ project_id: 'p-1', order_no: 'PO-1', bay_codes: ['A38'] }),
    ]));

    expect(occupancy.byBay.A38.EDGE).toHaveLength(1);
    expect(occupancy.byBay.A38.CENTER).toHaveLength(1);
  });

  it('mengabaikan bay milik area lain', () => {
    const occupancy = buildZoneOccupancy('AREA-01', groupsFor([
      row({ project_id: 'p-1', order_no: 'PO-1', bay_codes: ['B30E'] }),
    ]));

    expect(occupancy.byBay.A38.EDGE).toHaveLength(0);
    expect(Object.keys(occupancy.byBay)).not.toContain('B30');
  });

  it('memakai satu bucket per booth untuk area tak berzona (Blasting & Painting)', () => {
    const occupancy = buildZoneOccupancy('AREA-18', groupsFor([
      row({ project_id: 'p-1', order_no: 'PO-1', bay_codes: ['PT1'] }),
      row({ schedule_id: 's2', project_id: 'p-2', order_no: 'PO-2', bay_codes: ['PT1'] }),
    ]));

    expect(occupancy.zoned).toBe(false);
    expect(occupancy.byBay.PT1).toHaveLength(2);
    expect(zoneOverlaps(occupancy)).toEqual([
      { bay: 'PT1', zone: null, groups: occupancy.byBay.PT1 },
    ]);
  });

  it('menghitung zona terpakai / total zona', () => {
    const occupancy = buildZoneOccupancy('AREA-01', groupsFor([
      row({ project_id: 'p-1', order_no: 'PO-1', bay_codes: ['A38E'] }),
    ]));

    // 4 bay fisik (A38-A35) x 2 zona = 8.
    expect(zoneUsage(occupancy)).toEqual({ used: 1, total: 8 });
  });

  it('mempertahankan zona kosong supaya peta tidak menyusut', () => {
    const occupancy = buildZoneOccupancy('AREA-01', groupsFor([
      row({ project_id: 'p-1', order_no: 'PO-1', bay_codes: ['A38E'] }),
    ]));

    expect(zoneUsage(occupancy).total - zoneUsage(occupancy).used).toBeGreaterThan(0);
    expect(occupancy.byBay.A35).toBeDefined();
    expect(occupancy.byBay.A35.EDGE).toEqual([]);
  });
});

describe('projectColor', () => {
  it('deterministik: nama sama -> warna sama', () => {
    const name = 'MPS - 8x MANHAUL 51 SEAT SDO - CJ-rev7';
    expect(projectColor(name)).toBe(projectColor(name));
    expect(hashProjectName(name)).toBe(hashProjectName(name));
  });

  it('memberi warna berbeda untuk token pembeda yang berbeda', () => {
    const a = projectColor('MPS - 8x MANHAUL 51 SEAT SDO - CJ-rev7');
    const b = projectColor('MPS - JOB INTERDIVE-2026');
    expect(a).not.toBe(b);
  });

  it('selalu mengembalikan warna dari palet, untuk nama apa pun', () => {
    const names = ['', 'A', 'PAINTING ROOM', 'MPS - 21 Units ISO TANK - ORICA - (PO 02.04.26)', '🙂'];
    names.forEach((name) => {
      const color = projectColor(name);
      if (name === '') expect(color).toBe('');
      else expect(PROJECT_COLORS).toContain(color);
    });
  });

  it('mode gelap memakai palet terang, bukan hasil pembalikan', () => {
    const name = 'MPS - JOB INTERDIVE-2026';
    expect(projectColor(name, true)).not.toBe(projectColor(name, false));
  });

  it('nama kosong tidak diberi warna', () => {
    expect(projectColor('')).toBe('');
    expect(projectColor(null)).toBe('');
    expect(projectColor(undefined)).toBe('');
  });
});

describe('shortProjectName', () => {
  it('membuang prefix seragam supaya token pembeda terlihat', () => {
    expect(shortProjectName('MPS - 8x MANHAUL 51 SEAT SDO - CJ-rev7')).toBe('8x MANHAUL 51 SEAT SDO - CJ-rev7');
    expect(shortProjectName('R1_MPS - BOTTOM DUMP - UBE')).toBe('R1 BOTTOM DUMP - UBE');
    expect(shortProjectName('MPS - PO - 42M3 DOUBLE TRAILER - MSM Set 10-12_Join'))
      .toBe('PO - 42M3 DOUBLE TRAILER - MSM Set 10-12_Join'.replace(/^PO\s*-\s*/, ''));
  });

  it('mempertahankan nama yang tidak punya prefix', () => {
    expect(shortProjectName('PAINTING ROOM')).toBe('PAINTING ROOM');
    expect(shortProjectName('JIG MAIN RUNNER')).toBe('JIG MAIN RUNNER');
  });
});

describe('bpSlotGroups — kelompok slot Blasting & Painting (PLAN §4.3)', () => {
  it('memisahkan Painting dan Blasting dari data area nyata', () => {
    const groups = bpSlotGroups(BLASTING_AREA.bays);
    expect(groups.map((g) => g.label)).toEqual(['Painting', 'Blasting']);
    expect(groups[0].bays).toEqual(['PT1', 'PT2', 'PT3']);
    expect(groups[1].bays).toEqual(['BL1', 'BL2']);
  });

  it('tidak menghilangkan satu bay pun dari peta', () => {
    const flat = bpSlotGroups(BLASTING_AREA.bays).flatMap((g) => g.bays);
    expect([...flat].sort()).toEqual([...BLASTING_AREA.bays].sort());
  });

  it('mengelompokkan lewat prefiks kode, bukan urutan posisi', () => {
    const groups = bpSlotGroups(['BL9', 'PT9', 'BL8']);
    expect(groups[0]).toMatchObject({ kind: 'painting', bays: ['PT9'] });
    expect(groups[1]).toMatchObject({ kind: 'blasting', bays: ['BL9', 'BL8'] });
  });

  it('membuang kelompok kosong, bukan merender header tanpa slot', () => {
    expect(bpSlotGroups(['PT1']).map((g) => g.kind)).toEqual(['painting']);
    expect(bpSlotGroups([])).toEqual([]);
    expect(bpSlotGroups(null)).toEqual([]);
  });

  it('mengabaikan entri kosong tanpa menabrak', () => {
    expect(bpSlotGroups(['PT1', '', null, '  '])).toEqual([
      { kind: 'painting', label: 'Painting', bays: ['PT1'] },
    ]);
  });

  it('bpKindOf tidak peka huruf besar/kecil dan aman untuk nilai aneh', () => {
    expect(bpKindOf('pt3')).toBe('painting');
    expect(bpKindOf('PT3')).toBe('painting');
    expect(bpKindOf('BL1')).toBe('blasting');
    expect(bpKindOf(undefined)).toBe('blasting');
  });
});


describe('rangeProgress — bar rentang panel detail (PLAN §5.4)', () => {
  it('menaruh hari ini di tengah rentang', () => {
    const r = rangeProgress('2026-01-01', '2026-01-11', '2026-01-06');
    expect(Math.round(r.percent)).toBe(50);
    expect(r).toMatchObject({ before: false, after: false, days: 11 });
  });

  it('menjepit ke 0..100 saat kursor di luar rentang', () => {
    expect(rangeProgress('2026-06-01', '2026-06-10', '2026-01-01'))
      .toMatchObject({ percent: 0, before: true });
    expect(rangeProgress('2026-06-01', '2026-06-10', '2026-12-31'))
      .toMatchObject({ percent: 100, after: true });
  });

  it('tidak menghasilkan NaN untuk reservasi satu hari', () => {
    const r = rangeProgress('2026-03-03', '2026-03-03', '2026-03-03');
    expect(r).toMatchObject({ percent: 0, days: 1, before: false, after: false });
    expect(Number.isNaN(r.percent)).toBe(false);
  });

  it('menolak rentang yang tidak masuk akal, bukan menggambar bar bohong', () => {
    expect(rangeProgress('2026-06-10', '2026-06-01', '2026-06-05')).toBeNull();
    expect(rangeProgress(null, '2026-06-01', '2026-06-05')).toBeNull();
    expect(rangeProgress('2026-06-01', '2026-06-10', null)).toBeNull();
  });
});

describe('zoneSelectionGroups — isi panel detail (PLAN §9 butir 6 & 12)', () => {
  const g = (key, bays) => ({ key, project: key, bays });
  const A = g('a', ['A38E']);
  const B = g('b', ['A38E']);   // overlap dengan A di zona yang sama
  const C = g('c', ['A38C']);
  const occ = () => buildZoneOccupancy('AREA-01', [A, B, C]);

  it('mengembalikan SEMUA reservasi pada zona overlap, bukan hanya yang pertama', () => {
    const rows = zoneSelectionGroups(occ(), { bay: 'A38', zone: 'EDGE' });
    expect(rows.map((r) => r.key)).toEqual(['a', 'b']);
  });

  it('memisahkan zona: CENTER tidak membawa reservasi EDGE', () => {
    expect(zoneSelectionGroups(occ(), { bay: 'A38', zone: 'CENTER' }).map((r) => r.key))
      .toEqual(['c']);
  });

  it('menggabungkan kedua zona saat bay dipilih tanpa zona, tanpa duplikat', () => {
    const rows = zoneSelectionGroups(occ(), { bay: 'A38' });
    expect([...rows.map((r) => r.key)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('tanpa selection mengembalikan seluruh area supaya panel tidak kosong', () => {
    expect(zoneSelectionGroups(occ(), null).map((r) => r.key).sort()).toEqual(['a', 'b', 'c']);
  });

  it('aman untuk bay di luar area dan occupancy kosong', () => {
    expect(zoneSelectionGroups(occ(), { bay: 'ZZ9' })).toEqual([]);
    expect(zoneSelectionGroups(null, { bay: 'A38' })).toEqual([]);
  });
});
