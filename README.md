# in-memory-db-table

`in-memory-db-table` is a small TypeScript library for
storing records in memory while querying them with
database-style indexed equality lookups.

It is extracted from the scheduler state layer in the
SchoolMate application, where it is used as the central
client-side store for things like:

- schedule entries keyed by `courseSectionId` and
  `periodId`
- course sections keyed by `courseId`
- conflicts keyed by `conflictType` and `periodId`
- join tables such as course-section-to-teacher and
  course-section-to-class mappings

The core idea is simple:

- every row is stored by primary key `id`
- you can opt into secondary indices for selected
  columns
- queries are exact-match filters on indexed columns
- chained filters behave like `AND`
- the underlying data is MobX-observable, so computed
  values, reactions, and UI bindings can observe query
  results

This package is intentionally small. It does not try to
be a full ORM, a SQL parser, or a normalized entity
framework. It is a focused utility for “I want a fast,
observable, in-memory table with predictable lookup
semantics.”

## Install

```bash
npm install in-memory-db-table mobx
```

## Peer Dependencies

- `mobx` `>=6.0.0 <7`

## Who This Is For

This library is a good fit when you:

- already keep client-side data in MobX state
- want to normalize records by `id`
- repeatedly answer questions like “give me all rows for
  this foreign key”
- want to chain exact-match filters across a small set of
  indexed columns
- want a lightweight abstraction instead of scanning
  arrays manually all over the codebase

This library is especially useful for feature state that
behaves like a relational graph in the UI:

- many-to-many join tables
- lookup tables for ids -> entities
- filtered collections that must stay in sync as data is
  inserted, updated, or removed

## Mental Model

Think of an `InMemoryDBTable` as a MobX-observable table
with:

- a mandatory primary key: `id`
- zero or more secondary equality indices
- an immutable query builder for composing filters
- snapshot-style read APIs
- mutation APIs that keep indices in sync automatically

If you have ever modeled UI data with:

- a `Map<string, T>` for direct access
- extra `Map<columnValue, Set<id>>` structures for
  filtering
- helper methods for “first”, “exists”, “count”, and
  “delete matching rows”

this package formalizes that pattern into one reusable
primitive.

## Quick Start

```ts
import { autorun } from 'mobx';
import { InMemoryDBTable } from 'in-memory-db-table';

type CourseSection = {
  id: string;
  courseId: string;
  roomId: string | null;
  colorHex: string;
};

const courseSections = new InMemoryDBTable<
  CourseSection,
  'courseId' | 'roomId'
>([], ['courseId', 'roomId']);

courseSections.upsert([
  {
    id: 'section-1',
    courseId: 'course-1',
    roomId: 'room-a',
    colorHex: '#2463eb',
  },
  {
    id: 'section-2',
    courseId: 'course-1',
    roomId: null,
    colorHex: '#1f8f5f',
  },
]);

const sameCourse = courseSections
  .whereIndexedColumn('courseId', 'course-1')
  .get();

console.log(sameCourse.length); // 2

const dispose = autorun(() => {
  console.log(
    'Sections in room-a:',
    courseSections
      .whereIndexedColumn('roomId', 'room-a')
      .count()
  );
});

courseSections.delete('section-1');

dispose();
```

## Core API

## `new InMemoryDBTable(records?, columnsToIndex?)`

Creates a table.

```ts
const table = new InMemoryDBTable<User, 'role' | 'teamId'>(
  [],
  ['role', 'teamId']
);
```

### Rules

- `T` must include `id: string`
- `columnsToIndex` should only include columns you plan
  to query frequently
- `id` is always available as an implicit primary-key
  index
- only configured indexed columns can be used with
  `whereIndexedColumn(...)`

### What gets stored internally

The table maintains:

- a record map: `id -> record`
- one secondary index per configured column:
  `columnValue -> Set<id>`

Whenever you insert, update, or delete rows, those index
maps are kept in sync for you.

## `table.upsert(record)` / `table.upsert(records)`

Adds or replaces rows by `id`.

```ts
table.upsert({
  id: 'teacher-1',
  departmentId: 'science',
  name: 'Ada Lovelace',
});
```

```ts
table.upsert([
  {
    id: 'teacher-1',
    departmentId: 'science',
    name: 'Ada Lovelace',
  },
  {
    id: 'teacher-2',
    departmentId: 'math',
    name: 'Grace Hopper',
  },
]);
```

### Update semantics

If a row with the same `id` already exists:

- the old record is replaced
- all configured secondary indices are updated
- old index entries that no longer apply are removed

That behavior is important for UI state where a record’s
foreign key can change over time. For example, if a row
moves from `teacherId = a` to `teacherId = b`, queries for
`a` stop returning it and queries for `b` start returning
it immediately.

## `table.delete(id)` / `table.delete(ids)`

Deletes one or more rows by primary key.

```ts
table.delete('entry-1');
table.delete(['entry-2', 'entry-3']);
```

Missing ids are ignored. All secondary indices are
cleaned up automatically.

## `table.get()`

Returns every row currently in the table.

```ts
const allRows = table.get();
```

This is useful when:

- you want a full snapshot
- the table is small enough that filtering in memory is
  acceptable
- you are hydrating another derived structure

## `table.get(id)`

Returns a single row or `null`.

```ts
const row = table.get('section-1');
```

This is the direct primary-key lookup path.

## `table.get(ids)`

Returns the rows for the provided ids, in the same order
as the input, while skipping ids that are missing.

```ts
const teachers = teachersTable.get([
  'teacher-3',
  'teacher-1',
  'missing-teacher',
]);
```

That usage pattern shows up frequently when one table
stores only relationship rows and another table stores the
entity rows. In SchoolMate, the scheduler uses this shape
for patterns like:

1. query a join table for `teacherId`s or `classId`s
2. feed those ids into the entity table
3. get back the matching loaded entities in a stable order

## `table.whereIndexedColumn(column, value)`

Starts an indexed query.

```ts
const query = table.whereIndexedColumn(
  'teacherId',
  'teacher-1'
);
```

The returned query is immutable. Each additional filter
returns a new query instance.

```ts
const results = table
  .whereIndexedColumn('teacherId', 'teacher-1')
  .whereIndexedColumn('room', 'room-a')
  .get();
```

This behaves like:

```sql
WHERE teacher_id = 'teacher-1'
  AND room = 'room-a'
```

### Important limitation

This package supports exact-match lookups on indexed
columns only. It does not support:

- partial string matching
- range queries
- sorting operators
- joins
- OR groups

If you need those, fetch the rows you want and derive the
rest in normal JavaScript.

## Query API

Once you have a query, you can use the following methods.

## `query.get()`

Returns the matching rows.

```ts
const rows = table
  .whereIndexedColumn('courseId', 'course-1')
  .get();
```

Internally the query resolves the indexed candidate sets,
picks the smallest one, and intersects the rest. That
keeps chained equality queries efficient without scanning
every row.

## `query.get(column)`

Projects a single column out of the matched rows.

```ts
const teacherIds = courseSectionTeachers
  .whereIndexedColumn('courseSectionId', 'section-1')
  .get('teacherId');
```

This is one of the most important usage patterns from the
SchoolMate scheduler. Join-table style records are queried
by one foreign key, and then the opposite side of the
relationship is projected directly.

Examples:

- “Give me every `teacherId` attached to this
  `courseSectionId`.”
- “Give me every `classId` attached to this
  `courseSectionId`.”
- “Give me every `conflictId` attached to this period.”

## `query.get(column, true)`

Projects a column and removes duplicates.

```ts
const uniqueRoomIds = entries
  .whereIndexedColumn('teacherId', 'teacher-1')
  .get('roomId', true);
```

## `query.exists()`

Returns `true` if any row matches.

```ts
const hasConflict = conflicts
  .whereIndexedColumn('id', conflictId)
  .whereIndexedColumn('periodId', periodId)
  .exists();
```

This pattern is useful for fast guard clauses and cheap
boolean checks in computed values.

## `query.count()`

Counts matching rows without allocating the result array.

```ts
const count = schedulerConflicts
  .whereIndexedColumn('periodId', periodId)
  .count();
```

This is a strong fit for:

- badge counts
- summary pills
- empty-state checks
- rendering optimizations where you only need the total

## `query.first()`

Returns the first matching row or `null`.

```ts
const row = table
  .whereIndexedColumn('teacherId', 'teacher-2')
  .first();
```

Use this when the logical cardinality is “zero or one,”
or when any single match is sufficient.

## `query.delete()`

Deletes every row that matches the query.

```ts
courseSectionTeachers
  .whereIndexedColumn('courseSectionId', 'section-1')
  .delete();
```

This is especially convenient for join-table replacement
flows:

1. delete the existing relationship rows for an owner
2. insert the replacement rows

That is a common pattern in feature state when the server
returns the new authoritative list for a relationship.

## `table.uniqueColumnValues(column)`

Returns a `Set` of unique values for an indexed column, or
for `id`.

```ts
const dayNumbers = periods.uniqueColumnValues(
  'day_of_the_week'
);
```

This was added for UI patterns where you want to build
filters or grouped views from the current contents of the
table without rescanning every record manually.

Examples:

- list every teacher that currently appears
- list every day value represented in period rows
- build facet-like filter controls from loaded data

## MobX Behavior

The table and its indices are backed by MobX observable
maps and sets.

That means MobX reactions can observe:

- full-table reads
- indexed query counts
- query existence checks
- query results used in computed values or `autorun`

Example:

```ts
import { autorun } from 'mobx';

const dispose = autorun(() => {
  const teacherOneCount = classes
    .whereIndexedColumn('teacherId', 'teacher-1')
    .count();

  console.log(teacherOneCount);
});
```

When matching rows are inserted, updated, or deleted, the
reaction re-runs because the underlying observable state
changed.

## Real Usage Patterns From SchoolMate

The scheduler feature in SchoolMate uses multiple tables
together to represent a normalized client-side data graph.
These examples are generalized from that usage.

## 1. Entity tables

Store full entities by id, optionally with a few useful
secondary indices.

```ts
type CourseSection = {
  id: string;
  courseId: string;
  roomId: string | null;
  colorHex: string;
};

const courseSections = new InMemoryDBTable<
  CourseSection,
  'courseId'
>([], ['courseId']);
```

Use cases:

- get a section by id
- get all sections for a course
- update a section in place

## 2. Join tables

Store relationship rows and project the opposite id back
out of the query.

```ts
type CourseSectionTeacher = {
  id: string;
  courseSectionId: string;
  teacherId: string;
};

const courseSectionTeachers = new InMemoryDBTable<
  CourseSectionTeacher,
  'courseSectionId' | 'teacherId'
>([], ['courseSectionId', 'teacherId']);

const teacherIds = courseSectionTeachers
  .whereIndexedColumn('courseSectionId', 'section-1')
  .get('teacherId');
```

This lets feature-level state stay very explicit and easy
to reason about.

## 3. Composite filtering

Chain multiple indexed columns to narrow a result set.

```ts
const entriesInPeriodForSection = periodEntries
  .whereIndexedColumn('courseSectionId', 'section-1')
  .whereIndexedColumn('periodId', 'period-3')
  .get();
```

This is effectively a composite lookup without requiring
a dedicated combined index declaration.

## 4. Fast existence checks across normalized data

Use one query to pull relationship ids, then use another
query to validate context.

```ts
const hasConflictInPeriod = conflictCourseSections
  .whereIndexedColumn('courseSectionId', 'section-1')
  .get('conflictId')
  .some((conflictId) =>
    conflicts
      .whereIndexedColumn('id', conflictId)
      .whereIndexedColumn('periodId', 'period-3')
      .exists()
  );
```

This keeps the data normalized while still giving
feature-specific selectors readable building blocks.

## 5. Deriving entities from relationship rows

Fetch relationship ids first, then load the entities.

```ts
const classIds = courseSectionClasses
  .whereIndexedColumn('courseSectionId', 'section-1')
  .get('classId');

const classesForSection = classesTable.get(classIds);
```

This pattern is one of the main reasons the `get(ids)`
overload exists.

## Design Constraints

This library deliberately makes a few tradeoffs:

- only `id` is treated as the primary key
- indices are equality-only
- secondary indices are opt-in
- query ordering follows the iteration order of the
  underlying matching id set
- there is no cross-table abstraction; composition is done
  in your own selectors and state objects

Those constraints keep the implementation small and the
runtime behavior predictable.

## TypeScript Notes

The generic parameters are:

```ts
InMemoryDBTable<T, IndexedColumns>
```

Where:

- `T` is the record shape and must include `id: string`
- `IndexedColumns` is a union of non-`id` keys you want to
  allow in `whereIndexedColumn(...)`

Example:

```ts
type PeriodEntry = {
  id: string;
  courseSectionId: string;
  periodId: string;
  orderNum: number;
};

const entries = new InMemoryDBTable<
  PeriodEntry,
  'courseSectionId' | 'periodId'
>([], ['courseSectionId', 'periodId']);
```

If you try to query a column that is not part of
`IndexedColumns` (or `id`), TypeScript will reject it.

## Testing

The package includes Jest tests covering:

- primary-key reads
- single-column and multi-column indexed queries
- index updates after upserts
- index cleanup after deletes
- column projection
- distinct projection
- unique value extraction
- query helpers like `exists`, `count`, `first`, and
  `delete`
- MobX reaction behavior

Run them with:

```bash
npm test
```

## Build

Build the package with:

```bash
npm run build
```

The package is bundled with `tsup` and emits:

- ESM output
- CommonJS output
- type declarations
- source maps

## When Not To Use This

This is probably the wrong abstraction if:

- your data is naturally just one small array
- you need server-synchronized caching semantics like
  TanStack Query
- you need relational writes, joins, or ad hoc querying
- you need sorted indices or range scans
- you are not using MobX and do not care about observable
  data structures

## API Summary

```ts
const table = new InMemoryDBTable<T, IndexedColumns>(
  records?,
  indexedColumns?
);

table.upsert(record);
table.upsert(records);

table.delete(id);
table.delete(ids);

table.get();
table.get(id);
table.get(ids);

table.whereIndexedColumn(column, value);
table.uniqueColumnValues(column);

query.whereIndexedColumn(column, value);
query.get();
query.get(column, distinct?);
query.exists();
query.count();
query.first();
query.delete();
```

## License

`UNLICENSED`
