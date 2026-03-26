/* eslint-disable max-lines */
import {
  action,
  observable,
  ObservableMap,
  ObservableSet,
} from 'mobx';

/**
 * Observable in-memory table that stores an automatically indexed list
 * of objects. Every record is indexed by `id`, and optional secondary
 * indices can be configured for any additional columns. Consumers can
 * then query the table by `id` or any combination of indexed columns,
 * mimicking database-style lookups.
 *
 * Typical usage:
 * ```ts
 * const classes = new InMemoryDBTable<ClassRecord>([], ['teacherId']);
 * classes.upsert({ id: 'class-1', teacherId: 'teacher-1', name: 'Algebra I' });
 * const teacherClasses = classes
 *   .whereIndexedColumn('teacherId', 'teacher-1')
 *   .get();
 * ```
 *
 * @template T Record shape stored inside the table (must include id).
 * @template IndexedColumns Subset of keys that should be indexed.
 */
export class InMemoryDBTable<
  T extends { id: string },
  IndexedColumns extends Exclude<keyof T, 'id'> = never,
> {
  @observable
  private accessor state = new InMemoryDBTableState<
    T,
    IndexedColumns
  >();

  /**
   * Creates a new table and optionally prepopulates it with records
   * while configuring which columns should receive indices. Call this
   * once per logical table you want to maintain in memory.
   *
   * @param records Initial data to load immediately after construction.
   * @param columnsToIndex Columns to index for fast equality filters.
   */
  constructor(
    records: T[] = [],
    columnsToIndex: IndexedColumns[] = []
  ) {
    for (const column of columnsToIndex) {
      if (column === 'id') {
        continue;
      }

      this.state.columnsToIndex.add(column);
    }

    this.upsert(records);
  }

  /**
   * Inserts new records or updates existing ones based on their `id`.
   * The method is overloaded so callers can provide either a single
   * record or an array. All configured indices are updated so future
   * queries reflect the new state.
   *
   * @param recordOrRecords Single record or list of records to persist.
   */
  public upsert(records: T[]): void;
  public upsert(record: T): void;
  @action public upsert(recordOrRecords: T | T[]): void {
    const upsertSingle = (record: T): void => {
      const previousRecord = this.state.records.get(
        record.id
      );

      this.state.records.set(record.id, record);

      for (const column of this.state.columnsToIndex) {
        if (previousRecord) {
          this.removeRecordFromIndex(
            previousRecord,
            column
          );
        }

        this.indexRecord(record, column);
      }
    };

    if (Array.isArray(recordOrRecords)) {
      recordOrRecords.forEach((record) =>
        upsertSingle(record)
      );
      return;
    }

    upsertSingle(recordOrRecords);
  }

  /**
   * Deletes records by id. Accept either a single id or an array to
   * perform batch deletes. Indices are cleaned up automatically to avoid
   * dangling pointers that could pollute query results.
   *
   * Missing ids are ignored.
   *
   * @param id Single id or list of ids to remove.
   */
  public delete(id: string): void;
  public delete(ids: string[]): void;
  @action public delete(id: string | string[]): void {
    const deleteSingle = (recordId: string): void => {
      const existingRecord =
        this.state.records.get(recordId);

      if (!existingRecord) {
        return;
      }

      for (const column of this.state.columnsToIndex) {
        this.removeRecordFromIndex(existingRecord, column);
      }

      this.state.records.delete(recordId);
    };

    if (Array.isArray(id)) {
      id.forEach((singleId) => deleteSingle(singleId));
      return;
    }

    deleteSingle(id);
  }

  /**
   * Fetches records by their primary key:
   * - `get()` with no args returns a snapshot array of every record.
   * - `get('record-id')` returns the matching record or `null`.
   * - `get(['a', 'b'])` returns only the records that currently exist,
   *   preserving the order of the id list and omitting missing ids.
   *
   * Prefer this method for direct primary-key reads; use
   * `whereIndexedColumn` when filtering on secondary columns.
   *
   * @param idOrIds Optional id or list of ids to find.
   */
  public get(id: string): T | null;
  public get(ids: string[]): T[];
  public get(): T[];
  public get(idOrIds?: string | string[]): T | T[] | null {
    if (idOrIds === undefined) {
      return [...this.state.records.values()];
    }

    if (Array.isArray(idOrIds)) {
      const uniqueIds = Array.from(new Set(idOrIds));

      return uniqueIds.flatMap((id) => {
        const record = this.state.records.get(id);
        return record ? [record] : [];
      });
    }

    return this.state.records.get(idOrIds) ?? null;
  }

  /**
   * Begins building a query limited to a single indexed column. Chain
   * additional `whereIndexedColumn` calls to AND multiple filters
   * together, then finish with `get()`, `exists()`, `count()`, `first()`,
   * or `delete()` on the returned query instance.
   *
   * @param column Indexed column (or `id`) being filtered.
   * @param value Exact value required for the column.
   */
  public whereIndexedColumn<
    Key extends IndexedColumns | 'id',
  >(
    column: Key,
    value: T[Key]
  ): InMemoryDBTableQuery<this> {
    return new InMemoryDBTableQuery(this.state as any, [
      [column as any, value],
    ]);
  }

  /**
   * Returns the set of unique values currently present for the specified
   * column. For the implicit `id` index the set contains every record id.
   * For secondary indices it exposes the cached keys that can be queried
   * via `whereIndexedColumn`. Useful for filter UIs and summary chips.
   *
   * @param column Either `id` or one of the indexed columns.
   * @returns Set containing each unique value found for that column.
   */
  public uniqueColumnValues<
    Key extends IndexedColumns | 'id',
  >(column: Key): Set<T[Key]> {
    const values = new Set<T[Key]>();

    if (column === 'id') {
      for (const recordId of this.state.records.keys()) {
        values.add(recordId as T[Key]);
      }

      return values;
    }

    const columnIndex = this.state.indices.get(
      column as IndexedColumns
    );

    if (!columnIndex) {
      return values;
    }

    for (const key of columnIndex.keys()) {
      values.add(key as T[Key]);
    }

    return values;
  }

  /**
   * Internal helper invoked during `upsert` to ensure the supplied record
   * is visible through secondary indices. Consumers never call this
   * directly.
   */
  @action private indexRecord(
    record: T,
    column: keyof T
  ): void {
    const columnValue = record[column];

    if (!this.state.indices.has(column)) {
      this.state.indices.set(column, new ObservableMap());
    }

    const columnIndex = this.state.indices.get(column)!;

    if (!columnIndex.has(columnValue)) {
      columnIndex.set(columnValue, new ObservableSet());
    }

    const idSet = columnIndex.get(columnValue)!;
    idSet.add(record.id);
  }

  /**
   * Internal helper invoked when records are removed or updated. It
   * eliminates a record id from a specific column index and prunes the
   * index entry entirely if the id set becomes empty.
   */
  @action private removeRecordFromIndex(
    record: T,
    column: keyof T
  ): void {
    const columnValue = record[column];
    const columnIndex = this.state.indices.get(column);

    if (!columnIndex) {
      return;
    }

    const idSet = columnIndex.get(columnValue);

    if (!idSet) {
      return;
    }

    idSet.delete(record.id);

    if (idSet.size === 0) {
      columnIndex.delete(columnValue);
    }
  }
}

type TableRecordType<T> =
  T extends InMemoryDBTable<infer R, any> ? R : never;

type TableIndexedColumns<T> =
  T extends InMemoryDBTable<any, infer Indexed>
    ? Indexed | 'id'
    : never;

/**
 * Immutable query builder returned from
 * `InMemoryDBTable#whereIndexedColumn`.
 * Chain filters to narrow the result set and then call `get` / `exists`
 * / `count` / `first` / `delete` to materialize or mutate the result.
 */
class InMemoryDBTableQuery<
  Table extends InMemoryDBTable<any, any>,
> {
  /**
   * Consumers should not construct this class manually. Use
   * `InMemoryDBTable#whereIndexedColumn` so state references and filters
   * are wired correctly.
   */
  constructor(
    private readonly state: InMemoryDBTableState<
      TableRecordType<Table>,
      TableIndexedColumns<Table>
    >,
    private readonly indexedColumnFilters: [
      key: TableIndexedColumns<Table>,
      value: unknown,
    ][] = []
  ) {}

  /**
   * Returns a new query with another indexed filter applied. Each call
   * behaves like an AND condition.
   */
  whereIndexedColumn<
    Key extends TableIndexedColumns<Table>,
  >(
    column: Key,
    value: TableRecordType<Table>[Key]
  ): InMemoryDBTableQuery<Table> {
    return new InMemoryDBTableQuery<Table>(this.state, [
      ...this.indexedColumnFilters,
      [column, value],
    ]);
  }

  /**
   * Counts matching records without materializing the result array.
   */
  count(): number {
    let count = 0;

    for (const _recordId of this.getResultIds()) {
      count += 1;
    }

    return count;
  }

  /**
   * Quickly determines whether any records match the filters.
   */
  exists(): boolean {
    for (const _recordId of this.getResultIds()) {
      return true;
    }

    return false;
  }

  /**
   * Returns the first matching record, or `null` if none match.
   */
  first(): TableRecordType<Table> | null {
    for (const id of this.getResultIds()) {
      const record = this.state.records.get(id);

      if (record) {
        return record;
      }
    }

    return null;
  }

  /**
   * Deletes every record that matches the configured filters.
   */
  @action delete(): void {
    const ids = Array.from(this.getResultIds());

    for (const recordId of ids) {
      const existingRecord =
        this.state.records.get(recordId);

      if (!existingRecord) {
        continue;
      }

      for (const column of this.state.columnsToIndex) {
        this.removeRecordFromIndex(existingRecord, column);
      }

      this.state.records.delete(recordId);
    }
  }

  /**
   * Materializes the query result set. When a column name is supplied,
   * it projects that column from each matching record. Passing
   * `distinct: true` returns unique values for the requested column.
   */
  get<Column extends keyof TableRecordType<Table>>(
    column: Column,
    distinct?: boolean
  ): TableRecordType<Table>[Column][];
  get(): TableRecordType<Table>[];
  get(column?: unknown, distinct: boolean = false): unknown {
    if (column === undefined) {
      const results: TableRecordType<Table>[] = [];

      for (const id of this.getResultIds()) {
        const record = this.state.records.get(id);

        if (record) {
          results.push(record);
        }
      }

      return results;
    }

    const distinctValues = new Set<unknown>();
    const projectedValues: unknown[] = [];

    for (const id of this.getResultIds()) {
      const record = this.state.records.get(id);

      if (!record) {
        continue;
      }

      const projectedValue =
        record[column as keyof TableRecordType<Table>];

      if (distinct) {
        distinctValues.add(projectedValue);
      } else {
        projectedValues.push(projectedValue);
      }
    }

    return distinct
      ? Array.from(distinctValues)
      : projectedValues;
  }

  @action private removeRecordFromIndex(
    record: TableRecordType<Table>,
    column: TableIndexedColumns<Table>
  ): void {
    const columnValue =
      record[column as keyof typeof record];
    const columnIndex = this.state.indices.get(column);

    if (!columnIndex) {
      return;
    }

    const idSet = columnIndex.get(columnValue);

    if (!idSet) {
      return;
    }

    idSet.delete(record.id);

    if (idSet.size === 0) {
      columnIndex.delete(columnValue);
    }
  }

  private *getResultIds(): Iterable<string> {
    if (this.indexedColumnFilters.length === 0) {
      for (const id of this.state.records.keys()) {
        yield id;
      }

      return;
    }

    const resolvedIndexSets = this.indexedColumnFilters.map(
      ([column, value]) => {
        if (column === 'id') {
          return this.state.records.has(value as string)
            ? new Set<string>([value as string])
            : new Set<string>();
        }

        const columnIndex = this.state.indices.get(column);
        return columnIndex?.get(value) ?? new Set<string>();
      }
    );

    const smallestSet = resolvedIndexSets.reduce(
      (smallest, current) =>
        current.size < smallest.size ? current : smallest
    );

    for (const id of smallestSet) {
      if (resolvedIndexSets.every((set) => set.has(id))) {
        yield id;
      }
    }
  }
}

type IndicesMap<T> = ObservableMap<
  keyof T,
  ObservableMap<unknown, ObservableSet<string>>
>;

/**
 * Internal MobX-backed container that holds table rows, indices, and
 * configured indexed columns. Queries share this state with the table so
 * all reads and writes observe the same data.
 */
class InMemoryDBTableState<
  T extends { id: string },
  IndexedColumns extends keyof T,
> {
  @observable
  public accessor records: ObservableMap<string, T> =
    new ObservableMap();

  @observable
  public accessor indices: IndicesMap<T> =
    new ObservableMap();

  @observable
  public accessor columnsToIndex: ObservableSet<IndexedColumns> =
    new ObservableSet();
}
