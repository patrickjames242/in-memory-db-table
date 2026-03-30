/* eslint-disable max-lines */
import { autorun } from 'mobx';
import { InMemoryDBTable } from '../InMemoryDBTable';

type ClassRecord = {
  id: string;
  teacherId: string;
  room: string;
  subject: string;
};

const baseRecords: ClassRecord[] = [
  {
    id: 'class-1',
    teacherId: 'teacher-1',
    room: 'room-a',
    subject: 'math',
  },
  {
    id: 'class-2',
    teacherId: 'teacher-2',
    room: 'room-a',
    subject: 'history',
  },
  {
    id: 'class-3',
    teacherId: 'teacher-1',
    room: 'room-b',
    subject: 'science',
  },
  {
    id: 'class-4',
    teacherId: 'teacher-3',
    room: 'room-c',
    subject: 'english',
  },
];

const createClassesTable = (): InMemoryDBTable<
  ClassRecord,
  'teacherId' | 'room'
> => {
  const table = new InMemoryDBTable<
    ClassRecord,
    'teacherId' | 'room'
  >([], ['teacherId', 'room']);

  table.upsert(baseRecords);

  return table;
};

describe('InMemoryDBTable indexing', () => {
  it('returns results for a single indexed column query', () => {
    const table = createClassesTable();

    const teacherOneClasses = table
      .whereIndexedColumn('teacherId', 'teacher-1')
      .get();

    expect(
      teacherOneClasses.map((record) => record.id)
    ).toEqual(
      expect.arrayContaining(['class-1', 'class-3'])
    );
  });

  it('combines multiple indexed filters to narrow the result', () => {
    const table = createClassesTable();

    const classes = table
      .whereIndexedColumn('teacherId', 'teacher-1')
      .whereIndexedColumn('room', 'room-a')
      .get();

    expect(classes).toEqual([
      expect.objectContaining({ id: 'class-1' }),
    ]);
  });

  it('keeps indices in sync when upserting an existing record', () => {
    const table = createClassesTable();

    table.upsert({
      id: 'class-1',
      teacherId: 'teacher-2',
      room: 'room-a',
      subject: 'math',
    });

    const teacherOneClasses = table
      .whereIndexedColumn('teacherId', 'teacher-1')
      .get();
    const teacherTwoClasses = table
      .whereIndexedColumn('teacherId', 'teacher-2')
      .get();

    expect(
      teacherOneClasses.map((record) => record.id)
    ).toEqual(['class-3']);
    expect(
      teacherTwoClasses.map((record) => record.id)
    ).toEqual(
      expect.arrayContaining(['class-1', 'class-2'])
    );
    expect(teacherTwoClasses).toHaveLength(2);
  });

  it('cleans up index entries when deleting records', () => {
    const table = createClassesTable();

    table.delete(['class-1', 'class-3']);

    expect(
      table
        .whereIndexedColumn('teacherId', 'teacher-1')
        .get()
    ).toEqual([]);
    expect(
      table.whereIndexedColumn('room', 'room-a').get()
    ).toHaveLength(1);
  });

  it('supports querying by id through the indexed query API', () => {
    const table = createClassesTable();

    expect(
      table.whereIndexedColumn('id', 'class-2').get()
    ).toEqual([expect.objectContaining({ id: 'class-2' })]);
    expect(
      table.whereIndexedColumn('id', 'missing-class').get()
    ).toEqual([]);
  });

  it('returns no results when indexed filters do not intersect', () => {
    const table = createClassesTable();

    const results = table
      .whereIndexedColumn('teacherId', 'teacher-1')
      .whereIndexedColumn('room', 'room-c')
      .get();

    expect(results).toEqual([]);
  });

  it('returns results for an indexed IN query', () => {
    const table = createClassesTable();

    const classes = table
      .whereIndexedColumnIn('teacherId', [
        'teacher-1',
        'teacher-3',
      ])
      .get();

    expect(classes.map((record) => record.id)).toEqual(
      expect.arrayContaining([
        'class-1',
        'class-3',
        'class-4',
      ])
    );
    expect(classes).toHaveLength(3);
  });

  it('supports combining IN filters with other indexed filters', () => {
    const table = createClassesTable();

    const classes = table
      .whereIndexedColumnIn('teacherId', [
        'teacher-1',
        'teacher-2',
      ])
      .whereIndexedColumn('room', 'room-a')
      .get();

    expect(classes.map((record) => record.id)).toEqual(
      expect.arrayContaining(['class-1', 'class-2'])
    );
    expect(classes).toHaveLength(2);
  });

  it('filters missing ids out of id IN queries', () => {
    const table = createClassesTable();

    const query = table.whereIndexedColumnIn('id', [
      'missing-class',
      'class-2',
    ]);

    expect(query.exists()).toBe(true);
    expect(query.count()).toBe(1);
    expect(query.get()).toEqual([
      expect.objectContaining({ id: 'class-2' }),
    ]);
  });

  it('treats an id IN query with only missing ids as empty', () => {
    const table = createClassesTable();

    const query = table.whereIndexedColumnIn('id', [
      'missing-class',
      'missing-class-2',
    ]);

    expect(query.exists()).toBe(false);
    expect(query.count()).toBe(0);
    expect(query.first()).toBeNull();
    expect(query.get()).toEqual([]);
  });
});

describe('InMemoryDBTable get overloads', () => {
  it('returns every record when called without arguments', () => {
    const table = createClassesTable();

    expect(table.get()).toEqual(
      expect.arrayContaining(baseRecords)
    );
    expect(table.get()).toHaveLength(baseRecords.length);
  });

  it('returns a record by id and null for a missing id', () => {
    const table = createClassesTable();

    expect(table.get('class-2')).toEqual(
      expect.objectContaining({ id: 'class-2' })
    );
    expect(table.get('missing-class')).toBeNull();
  });

  it('returns existing records for multiple ids and skips missing ones', () => {
    const table = createClassesTable();

    const results = table.get([
      'class-3',
      'missing-class',
      'class-1',
      'class-3',
    ]);

    expect(results.map((record) => record.id)).toEqual([
      'class-3',
      'class-1',
    ]);
  });
});

describe('InMemoryDBTable column helpers', () => {
  it('returns unique values for an indexed column', () => {
    const table = createClassesTable();

    expect(
      Array.from(
        table.uniqueColumnValues('teacherId')
      ).sort()
    ).toEqual([
      'teacher-1',
      'teacher-2',
      'teacher-3',
    ]);
  });

  it('returns unique record ids when asked for the id column', () => {
    const table = createClassesTable();

    expect(
      Array.from(table.uniqueColumnValues('id')).sort()
    ).toEqual([
      'class-1',
      'class-2',
      'class-3',
      'class-4',
    ]);
  });

  it('projects a column from matching rows and can make it distinct', () => {
    const table = createClassesTable();

    expect(
      table
        .whereIndexedColumn('room', 'room-a')
        .get('teacherId')
    ).toEqual(['teacher-1', 'teacher-2']);
    expect(
      table.get().length
    ).toBe(baseRecords.length);
    expect(
      table
        .whereIndexedColumn('room', 'room-a')
        .get('room', true)
    ).toEqual(['room-a']);
  });
});

describe('InMemoryDBTableQuery helpers', () => {
  it('returns true when at least one record matches the filters', () => {
    const table = createClassesTable();

    expect(
      table
        .whereIndexedColumn('teacherId', 'teacher-2')
        .exists()
    ).toBe(true);
  });

  it('returns false when filters do not match any record', () => {
    const table = createClassesTable();

    expect(
      table
        .whereIndexedColumn('teacherId', 'teacher-1')
        .whereIndexedColumn('room', 'room-c')
        .exists()
    ).toBe(false);
  });

  it('returns the first record that matches the filters', () => {
    const table = createClassesTable();

    const firstRecord = table
      .whereIndexedColumn('teacherId', 'teacher-1')
      .first();

    expect(firstRecord).toEqual(
      expect.objectContaining({ id: 'class-1' })
    );
  });

  it('returns null when no records satisfy the filters', () => {
    const table = createClassesTable();

    const result = table
      .whereIndexedColumn('teacherId', 'teacher-1')
      .whereIndexedColumn('room', 'room-c')
      .first();

    expect(result).toBeNull();
  });

  it('counts matching rows without materializing all records', () => {
    const table = createClassesTable();

    expect(
      table
        .whereIndexedColumn('teacherId', 'teacher-1')
        .count()
    ).toBe(2);
  });

  it('removes every record that matches the filters', () => {
    const table = createClassesTable();

    table
      .whereIndexedColumn('teacherId', 'teacher-1')
      .delete();

    expect(
      table
        .whereIndexedColumn('teacherId', 'teacher-1')
        .get()
    ).toEqual([]);
    expect(
      table.whereIndexedColumn('room', 'room-a').get()
    ).toEqual([expect.objectContaining({ id: 'class-2' })]);
  });
});

describe('MobX integration', () => {
  it('reacts when rows are inserted into the table', () => {
    const table = new InMemoryDBTable<
      ClassRecord,
      'teacherId'
    >([], ['teacherId']);

    const counts: number[] = [];
    const dispose = autorun(() => {
      counts.push(
        table
          .whereIndexedColumn('teacherId', 'teacher-1')
          .count()
      );
    });

    table.upsert({
      id: 'class-1',
      teacherId: 'teacher-1',
      room: 'room-a',
      subject: 'math',
    });

    expect(counts).toEqual([0, 1]);

    dispose();
  });
});
