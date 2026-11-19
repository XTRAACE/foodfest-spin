import { getDb, type Queryable } from '../db/index.js';
import { broadcast } from '../lib/bus.js';
import { conflict, notFound } from '../lib/errors.js';
import { securePick } from '../lib/random.js';
import { numberLabel, toCustomer, type CustomerDTO, type Mode } from '../lib/serialize.js';
import { getSettings } from './settings.js';

const GROUP_SIZE = 3;

export interface RegisterInput {
  name: string;
  mobile?: string | null;
  rollNo?: string | null;
  course?: string | null;
  classLevel?: string | null;
}

/**
 * Allocates the next sequential customer number for a mode.
 * The counter row is locked, so two concurrent registrations can never share
 * a number and numbers are never reused.
 */
async function nextCustomerNumber(tx: Queryable, mode: Mode): Promise<number> {
  const key = `customer_${mode}`;
  await tx.query('insert into counters (key, value) values ($1, 0) on conflict (key) do nothing', [key]);
  const rows = await tx.query<{ value: string }>(
    'select value from counters where key = $1 for update',
    [key],
  );
  const next = Number(rows[0]?.value ?? 0) + 1;
  await tx.query('update counters set value = $2 where key = $1', [key, next]);
  return next;
}

/**
 * Brings one group of three in sync with the registered customers.
 * When all three members exist the group becomes complete and exactly one
 * member is chosen uniformly at random (CSPRNG).
 */
export async function syncGroup(
  tx: Queryable,
  mode: Mode,
  groupNumber: number,
): Promise<void> {
  await tx.query(
    `insert into customer_groups (mode, group_number) values ($1, $2)
     on conflict (mode, group_number) do nothing`,
    [mode, groupNumber],
  );

  const members = await tx.query<Record<string, any>>(
    `select id, customer_number, is_active from customers
      where mode = $1 and group_number = $2 order by customer_number`,
    [mode, groupNumber],
  );

  if (members.length < GROUP_SIZE) return;

  const active = members.filter((member) => member.is_active);
  if (active.length === 0) return;

  await tx.query(
    `update customer_groups
        set status = 'complete', completed_at = coalesce(completed_at, now())
      where mode = $1 and group_number = $2`,
    [mode, groupNumber],
  );

  const existing = await tx.query<{ id: string }>(
    'select id from group_selections where group_id = (select id from customer_groups where mode = $1 and group_number = $2)',
    [mode, groupNumber],
  );
  if (existing.length > 0) return;

  const chosen = securePick(active);
  await tx.query(
    `insert into group_selections (group_id, customer_id, mode, group_number, customer_number)
     select g.id, $1, $2, $3, $4 from customer_groups g where g.mode = $2 and g.group_number = $3
     on conflict (group_id) do nothing`,
    [chosen.id, mode, groupNumber, Number(chosen.customer_number)],
  );
}

export interface RegisterResult {
  customer: CustomerDTO;
  groupNumber: number;
  groupComplete: boolean;
  selected: boolean;
  selectedCustomerNumber: number | null;
  /** Name of the randomly selected group member, for the site popup + display. */
  selectedCustomer: { numberLabel: string; name: string } | null;
}

/** Public real-mode registration. */
export async function registerCustomer(input: RegisterInput): Promise<RegisterResult> {
  const db = await getDb();
  const settings = await getSettings(db);

  if (!settings.registrationOpen) {
    throw conflict('REGISTRATION_CLOSED', 'Registration is currently closed for this event.');
  }
  if (settings.eventStatus === 'ended') {
    throw conflict('EVENT_ENDED', 'This event has ended.');
  }

  const result = await db.transaction<RegisterResult>(async (tx) => {
    if (settings.duplicateMobileRule === 'reject') {
      // Mobile is optional now: prefer it for the duplicate check, otherwise
      // fall back to the roll number inside the same class.
      const duplicate = input.mobile
        ? await tx.query<{ customer_number: number }>(
            `select customer_number from customers
              where mode = 'real' and mobile = $1 and is_active = true limit 1`,
            [input.mobile],
          )
        : input.rollNo && input.classLevel
          ? await tx.query<{ customer_number: number }>(
              `select customer_number from customers
                where mode = 'real' and lower(roll_no) = lower($1)
                  and class_level = $2 and is_active = true limit 1`,
              [input.rollNo, input.classLevel],
            )
          : [];
      if (duplicate[0]) {
        throw conflict(
          'DUPLICATE_CUSTOMER',
          `This participant is already registered as customer ${numberLabel(duplicate[0].customer_number)}.`,
          { customerNumber: Number(duplicate[0].customer_number) },
        );
      }
    }

    const number = await nextCustomerNumber(tx, 'real');
    const groupNumber = Math.ceil(number / GROUP_SIZE);

    const inserted = await tx.query<Record<string, any>>(
      `insert into customers (mode, customer_number, group_number, name, mobile, roll_no, course, class_level)
       values ('real', $1, $2, $3, $4, $5, $6, $7) returning *`,
      [
        number,
        groupNumber,
        input.name,
        input.mobile ?? null,
        input.rollNo ?? null,
        input.course ?? null,
        input.classLevel ?? null,
      ],
    );

    await syncGroup(tx, 'real', groupNumber);

    const groupRows = await tx.query<{ status: string }>(
      `select status from customer_groups where mode = 'real' and group_number = $1`,
      [groupNumber],
    );
    const selectionRows = await tx.query<{ customer_number: number; name: string }>(
      `select gs.customer_number, c.name
         from group_selections gs join customers c on c.id = gs.customer_id
        where gs.mode = 'real' and gs.group_number = $1`,
      [groupNumber],
    );

    return {
      customer: toCustomer(inserted[0]!),
      groupNumber,
      groupComplete: groupRows[0]?.status === 'complete',
      selected: selectionRows[0]?.customer_number === number,
      selectedCustomerNumber: selectionRows[0] ? Number(selectionRows[0].customer_number) : null,
      selectedCustomer: selectionRows[0]
        ? {
            numberLabel: numberLabel(selectionRows[0].customer_number),
            name: selectionRows[0].name,
          }
        : null,
    };
  });

  broadcast({ type: 'data:changed', payload: { entity: 'customers' } });
  return result;
}

export interface CustomerQuery {
  mode: Mode;
  search?: string;
  groupNumber?: number;
  limit?: number;
}

export async function listCustomers(query: CustomerQuery): Promise<Array<Record<string, unknown>>> {
  const db = await getDb();
  const params: unknown[] = [query.mode];
  let sql = `
    select c.*,
           g.status as group_status,
           exists (select 1 from group_selections sel where sel.customer_id = c.id) as is_selected,
           (select sp.status from spins sp
             where sp.customer_id = c.id and sp.mode = c.mode
             order by sp.requested_at desc limit 1) as spin_status
      from customers c
      left join customer_groups g on g.mode = c.mode and g.group_number = c.group_number
     where c.mode = $1`;

  if (query.search) {
    const term = `%${query.search.trim().toLowerCase()}%`;
    params.push(term);
    sql += ` and (lower(c.name) like $${params.length} or coalesce(c.mobile, '') like $${params.length}
             or lower(coalesce(c.roll_no, '')) like $${params.length}
             or cast(c.customer_number as text) like $${params.length})`;
  }
  if (query.groupNumber) {
    params.push(query.groupNumber);
    sql += ` and c.group_number = $${params.length}`;
  }

  sql += ' order by c.customer_number asc';
  if (query.limit) {
    params.push(query.limit);
    sql += ` limit $${params.length}`;
  }

  const rows = await db.query<Record<string, any>>(sql, params);
  return rows.map((row) => ({
    ...toCustomer(row),
    groupStatus: row.group_status ?? 'waiting',
    isSelected: Boolean(row.is_selected),
    spinStatus: (row.spin_status as string | null) ?? null,
  }));
}

export async function updateCustomer(
  id: string,
  patch: {
    name?: string;
    mobile?: string | null;
    rollNo?: string | null;
    course?: string | null;
    classLevel?: string | null;
    isActive?: boolean;
  },
  actor: string,
): Promise<CustomerDTO> {
  const db = await getDb();
  const existing = await db.query<Record<string, any>>('select * from customers where id = $1', [id]);
  if (!existing[0]) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found.');

  const sets: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.name !== undefined) assign('name', patch.name);
  if (patch.mobile !== undefined) assign('mobile', patch.mobile);
  if (patch.rollNo !== undefined) assign('roll_no', patch.rollNo);
  if (patch.course !== undefined) assign('course', patch.course);
  if (patch.classLevel !== undefined) assign('class_level', patch.classLevel);
  if (patch.isActive !== undefined) assign('is_active', patch.isActive);

  if (sets.length === 0) return toCustomer(existing[0]);

  values.push(id);
  const updated = await db.query<Record<string, any>>(
    `update customers set ${sets.join(', ')} where id = $${values.length} returning *`,
    values,
  );

  await db.query(
    `insert into audit_logs (actor, action, entity, entity_id, details)
     values ($1, 'customer.updated', 'customer', $2, $3::jsonb)`,
    [actor, id, JSON.stringify(patch)],
  );
  broadcast({ type: 'data:changed', payload: { entity: 'customers' } });
  return toCustomer(updated[0]!);
}

export interface GroupDTO {
  id: string;
  mode: Mode;
  groupNumber: number;
  status: 'waiting' | 'complete';
  completedAt: string | null;
  members: CustomerDTO[];
  selection: {
    customerId: string;
    customerNumber: number;
    customerNumberLabel: string;
    customerName: string;
    createdAt: string | null;
  } | null;
  spin: {
    id: string;
    code: string;
    status: string;
    prizeName: string;
    completedAt: string | null;
  } | null;
}

export async function listGroups(mode: Mode): Promise<GroupDTO[]> {
  const db = await getDb();
  const [groupRows, customerRows, selectionRows, spinRows] = await Promise.all([
    db.query<Record<string, any>>(
      'select * from customer_groups where mode = $1 order by group_number',
      [mode],
    ),
    db.query<Record<string, any>>(
      'select * from customers where mode = $1 order by customer_number',
      [mode],
    ),
    db.query<Record<string, any>>('select * from group_selections where mode = $1', [mode]),
    db.query<Record<string, any>>('select * from spins where mode = $1 order by requested_at desc', [mode]),
  ]);

  const membersByGroup = new Map<number, Record<string, any>[]>();
  for (const customer of customerRows) {
    const key = Number(customer.group_number);
    const list = membersByGroup.get(key) ?? [];
    list.push(customer);
    membersByGroup.set(key, list);
  }

  const selectionByGroup = new Map<number, Record<string, any>>();
  for (const selection of selectionRows) {
    selectionByGroup.set(Number(selection.group_number), selection);
  }

  const customerNameById = new Map(customerRows.map((c) => [c.id as string, c.name as string]));

  return groupRows.map((group) => {
    const groupNumber = Number(group.group_number);
    const explicitSelection = selectionByGroup.get(groupNumber);
    const spin = explicitSelection
      ? spinRows.find((row) => row.customer_id === explicitSelection.customer_id)
      : undefined;

    return {
      id: group.id,
      mode: group.mode,
      groupNumber,
      status: group.status,
      completedAt: group.completed_at ? String(group.completed_at) : null,
      members: (membersByGroup.get(groupNumber) ?? []).map(toCustomer),
      selection: explicitSelection
        ? {
            customerId: explicitSelection.customer_id,
            customerNumber: Number(explicitSelection.customer_number),
            customerNumberLabel: numberLabel(explicitSelection.customer_number),
            customerName: customerNameById.get(explicitSelection.customer_id) ?? '',
            createdAt: explicitSelection.created_at ? String(explicitSelection.created_at) : null,
          }
        : null,
      spin: spin
        ? {
            id: spin.id,
            code: spin.spin_code,
            status: spin.status,
            prizeName: spin.prize_name,
            completedAt: spin.completed_at ? String(spin.completed_at) : null,
          }
        : null,
    };
  });
}

/**
 * Deletes one customer with their groups/spins. The admin panel confirms this
 * in a popup first; a deleted group goes back to waiting (never half-chosen).
 */
export async function deleteCustomer(
  id: string,
  actor: string,
): Promise<{ number: number; name: string; mode: Mode }> {
  const db = await getDb();
  const rows = await db.query<Record<string, any>>('select * from customers where id = $1', [id]);
  const customer = rows[0];
  if (!customer) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found.');

  await db.transaction(async (tx) => {
    await tx.query('delete from spins where customer_id = $1', [id]);
    await tx.query('delete from customers where id = $1', [id]);

    // A group whose selected member is gone can no longer be drawn from.
    await tx.query(
      `update customer_groups g
          set status = 'waiting', completed_at = null
        where g.mode = $1 and g.group_number = $2
          and not exists (select 1 from group_selections s where s.group_id = g.id)`,
      [customer.mode, customer.group_number],
    );
    await syncGroup(tx, customer.mode as Mode, Number(customer.group_number));

    await tx.query(
      `insert into audit_logs (actor, action, entity, entity_id, details)
       values ($1, 'customer.deleted', 'customer', $2, $3::jsonb)`,
      [actor, id, JSON.stringify({ number: customer.customer_number, name: customer.name })],
    );
  });

  broadcast({ type: 'data:changed', payload: { entity: 'customers' } });
  return {
    number: Number(customer.customer_number),
    name: customer.name as string,
    mode: customer.mode as Mode,
  };
}

/**
 * Wipes every customer of one mode (real or demo) together with their groups,
 * selections and spins, then restarts numbering at 001. The other mode is
 * never touched.
 */
export async function deleteAllCustomers(
  mode: Mode,
  actor: string,
): Promise<{ deleted: number; mode: Mode }> {
  const db = await getDb();

  const deleted = await db.transaction(async (tx) => {
    const counted = await tx.query<{ count: string }>(
      'select count(*)::text as count from customers where mode = $1',
      [mode],
    );
    await tx.query('delete from spins where mode = $1', [mode]);
    await tx.query('delete from group_selections where mode = $1', [mode]);
    await tx.query('delete from customer_groups where mode = $1', [mode]);
    await tx.query('delete from customers where mode = $1', [mode]);
    await tx.query('update counters set value = 0 where key = $1', [`customer_${mode}`]);

    const total = Number(counted[0]?.count ?? 0);
    await tx.query(
      `insert into audit_logs (actor, action, entity, details)
       values ($1, 'customers.deleted_all', 'customer', $2::jsonb)`,
      [actor, JSON.stringify({ mode, deleted: total })],
    );
    return total;
  });

  broadcast({ type: 'data:changed', payload: { entity: 'customers' } });
  return { deleted, mode };
}

/** Adds a customer directly from the admin panel (sequence still enforced). */
export async function createCustomerManually(
  input: RegisterInput & { mode: Mode },
  actor: string,
): Promise<CustomerDTO> {
  const db = await getDb();
  const created = await db.transaction(async (tx) => {
    const number = await nextCustomerNumber(tx, input.mode);
    const groupNumber = Math.ceil(number / GROUP_SIZE);
    const inserted = await tx.query<Record<string, any>>(
      `insert into customers (mode, customer_number, group_number, name, mobile, roll_no, course, class_level)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [
        input.mode,
        number,
        groupNumber,
        input.name,
        input.mobile ?? null,
        input.rollNo ?? null,
        input.course ?? null,
        input.classLevel ?? null,
      ],
    );
    await syncGroup(tx, input.mode, groupNumber);
    return inserted[0]!;
  });

  await db.query(
    `insert into audit_logs (actor, action, entity, entity_id, details)
     values ($1, 'customer.created', 'customer', $2, $3::jsonb)`,
    [actor, created.id, JSON.stringify({ number: created.customer_number })],
  );
  broadcast({ type: 'data:changed', payload: { entity: 'customers' } });
  return toCustomer(created);
}
