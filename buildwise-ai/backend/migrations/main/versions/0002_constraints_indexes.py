"""Database-level rules (CHECK constraints) and composite indexes for the real queries.

Revision ID: 0002
Revises: 0001

* CHECK constraints mirror the API validation, so bad data cannot get in through any other path either.
  A constraint is only added when no existing row violates it (a warning is printed otherwise), so this migration can
  never fail on, or delete, existing data.
* Composite indexes replace single-column ones that the actual queries cannot use well:
  projects(owner_id, updated_at)         list/dashboard: "my projects, newest first"
  project_rooms(project_id, floor_number, created_at)   rooms of a project in floor order
  reports(owner_id, created_at)          "my latest reports"
  estimate_items / optimization_recommendations (estimate_id, position)   items of an estimate in order
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None

CHECKS = {
    'projects': {
        'ck_projects_floors': 'floors >= 1 AND floors <= 50',
        'ck_projects_dims': 'length > 0 AND width > 0 AND height > 0 AND wall_thickness > 0 AND slab_thickness > 0',
        'ck_projects_budget': 'budget IS NULL OR budget > 0',
    },
    'project_rooms': {
        'ck_rooms_size': 'length > 0 AND width > 0 AND height > 0',
        'ck_rooms_counts': 'floor_number >= 1 AND doors >= 0 AND windows >= 0',
    },
    'material_price_records': {'ck_prices_nonneg': 'unit_price >= 0'},
}

# (table, old single-column index to drop or None, new index name, columns)
INDEXES = [
    ('projects', 'ix_projects_owner_id', 'ix_projects_owner_updated', ['owner_id', 'updated_at']),
    ('project_rooms', 'ix_project_rooms_project_id', 'ix_rooms_project_floor', ['project_id', 'floor_number', 'created_at']),
    ('reports', 'ix_reports_owner_id', 'ix_reports_owner_created', ['owner_id', 'created_at']),
    ('estimate_items', 'ix_estimate_items_estimate_id', 'ix_estimate_items_estimate_pos', ['estimate_id', 'position']),
    ('optimization_recommendations', 'ix_optimization_recommendations_estimate_id', 'ix_recs_estimate_pos', ['estimate_id', 'position']),
    ('project_estimates', None, 'ix_estimates_project_created', ['project_id', 'created_at']),
]


def _index_names(table):
    return {i['name'] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def _check_names(table):
    try:
        return {c['name'] for c in sa.inspect(op.get_bind()).get_check_constraints(table)}
    except NotImplementedError:
        return set()


def upgrade() -> None:
    bind = op.get_bind()
    for table, checks in CHECKS.items():
        have = _check_names(table)
        for name, expr in checks.items():
            if name in have:
                continue
            bad = bind.execute(sa.text(f'SELECT COUNT(*) FROM {table} WHERE NOT ({expr})')).scalar()
            if bad:
                print(f'WARNING: {bad} row(s) in {table} violate {name} ({expr}); constraint not added. Fix the data and re-run.')
                continue
            with op.batch_alter_table(table, schema=None) as batch_op:
                batch_op.create_check_constraint(name, expr)
    for table, old, new, cols in INDEXES:
        have = _index_names(table)
        with op.batch_alter_table(table, schema=None) as batch_op:
            if new not in have:
                batch_op.create_index(new, cols, unique=False)
            if old and old in have:
                batch_op.drop_index(old)


def downgrade() -> None:
    for table, old, new, cols in INDEXES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            if old:
                batch_op.create_index(old, [cols[0]], unique=False)
            batch_op.drop_index(new)
    for table, checks in CHECKS.items():
        for name in checks:
            with op.batch_alter_table(table, schema=None) as batch_op:
                batch_op.drop_constraint(name, type_='check')
