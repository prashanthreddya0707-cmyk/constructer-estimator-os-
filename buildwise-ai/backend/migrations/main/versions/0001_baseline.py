"""baseline: the schema as released before migrations were introduced (idempotent)

Revision ID: 0001
Revises: 
"""
from alembic import op
import sqlalchemy as sa


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def _exists(table: str) -> bool:
    """The baseline only creates what is missing, so databases made by earlier releases are adopted without touching data."""
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _exists('users'):
        op.create_table('users',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('full_name', sa.String(length=120), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('users', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)

    if not _exists('materials'):
        op.create_table('materials',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('owner_id', sa.String(length=36), nullable=True),
        sa.Column('estimate_key', sa.String(length=30), nullable=False),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('category', sa.String(length=80), nullable=False),
        sa.Column('brand', sa.String(length=120), nullable=False),
        sa.Column('grade', sa.String(length=120), nullable=False),
        sa.Column('specification', sa.Text(), nullable=False),
        sa.Column('durability_notes', sa.Text(), nullable=False),
        sa.Column('unit', sa.String(length=30), nullable=False),
        sa.Column('is_sample', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('materials', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_materials_estimate_key'), ['estimate_key'], unique=False)
            batch_op.create_index(batch_op.f('ix_materials_owner_id'), ['owner_id'], unique=False)

    if not _exists('projects'):
        op.create_table('projects',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('owner_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('owner_name', sa.String(length=120), nullable=False),
        sa.Column('building_type', sa.String(length=40), nullable=False),
        sa.Column('location', sa.String(length=160), nullable=False),
        sa.Column('floors', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(length=8), nullable=False),
        sa.Column('budget', sa.Float(), nullable=True),
        sa.Column('length', sa.Float(), nullable=False),
        sa.Column('width', sa.Float(), nullable=False),
        sa.Column('height', sa.Float(), nullable=False),
        sa.Column('wall_thickness', sa.Float(), nullable=False),
        sa.Column('slab_thickness', sa.Float(), nullable=False),
        sa.Column('built_up_area', sa.Float(), nullable=True),
        sa.Column('assumptions', sa.JSON(), nullable=False),
        sa.Column('wastage', sa.JSON(), nullable=False),
        sa.Column('material_selections', sa.JSON(), nullable=False),
        sa.Column('extra_costs', sa.JSON(), nullable=False),
        sa.Column('purchase_quantities', sa.JSON(), nullable=False),
        sa.Column('layout', sa.JSON(), nullable=True),
        sa.Column('is_demo', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('projects', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_projects_owner_id'), ['owner_id'], unique=False)

    if not _exists('floor_plan_files'):
        op.create_table('floor_plan_files',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('project_id', sa.String(length=36), nullable=False),
        sa.Column('owner_id', sa.String(length=36), nullable=False),
        sa.Column('original_name', sa.String(length=255), nullable=False),
        sa.Column('content_type', sa.String(length=80), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('storage_key', sa.String(length=255), nullable=False),
        sa.Column('width_px', sa.Integer(), nullable=True),
        sa.Column('height_px', sa.Integer(), nullable=True),
        sa.Column('scale_m_per_px', sa.Float(), nullable=True),
        sa.Column('calibration', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('floor_plan_files', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_floor_plan_files_owner_id'), ['owner_id'], unique=False)
            batch_op.create_index(batch_op.f('ix_floor_plan_files_project_id'), ['project_id'], unique=False)

    if not _exists('material_price_records'):
        op.create_table('material_price_records',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('material_id', sa.String(length=36), nullable=False),
        sa.Column('owner_id', sa.String(length=36), nullable=True),
        sa.Column('unit_price', sa.Float(), nullable=False),
        sa.Column('currency', sa.String(length=8), nullable=False),
        sa.Column('supplier', sa.String(length=160), nullable=False),
        sa.Column('location', sa.String(length=160), nullable=False),
        sa.Column('is_sample', sa.Boolean(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['material_id'], ['materials.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('material_price_records', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_material_price_records_material_id'), ['material_id'], unique=False)
            batch_op.create_index(batch_op.f('ix_material_price_records_owner_id'), ['owner_id'], unique=False)

    if not _exists('project_estimates'):
        op.create_table('project_estimates',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('project_id', sa.String(length=36), nullable=False),
        sa.Column('owner_id', sa.String(length=36), nullable=False),
        sa.Column('summary', sa.JSON(), nullable=False),
        sa.Column('geometry', sa.JSON(), nullable=False),
        sa.Column('assumptions', sa.JSON(), nullable=False),
        sa.Column('warnings', sa.JSON(), nullable=False),
        sa.Column('total_material_cost', sa.Float(), nullable=False),
        sa.Column('total_area_sqm', sa.Float(), nullable=False),
        sa.Column('currency', sa.String(length=8), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('project_estimates', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_project_estimates_owner_id'), ['owner_id'], unique=False)
            batch_op.create_index(batch_op.f('ix_project_estimates_project_id'), ['project_id'], unique=False)

    if not _exists('project_rooms'):
        op.create_table('project_rooms',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('project_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=80), nullable=False),
        sa.Column('room_type', sa.String(length=40), nullable=False),
        sa.Column('length', sa.Float(), nullable=False),
        sa.Column('width', sa.Float(), nullable=False),
        sa.Column('height', sa.Float(), nullable=False),
        sa.Column('floor_number', sa.Integer(), nullable=False),
        sa.Column('wall_thickness', sa.Float(), nullable=True),
        sa.Column('doors', sa.Integer(), nullable=False),
        sa.Column('windows', sa.Integer(), nullable=False),
        sa.Column('area_override', sa.Float(), nullable=True),
        sa.Column('pos_x', sa.Float(), nullable=True),
        sa.Column('pos_y', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('project_rooms', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_project_rooms_project_id'), ['project_id'], unique=False)

    if not _exists('estimate_items'):
        op.create_table('estimate_items',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('estimate_id', sa.String(length=36), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['estimate_id'], ['project_estimates.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('estimate_items', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_estimate_items_estimate_id'), ['estimate_id'], unique=False)

    if not _exists('optimization_recommendations'):
        op.create_table('optimization_recommendations',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('estimate_id', sa.String(length=36), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['estimate_id'], ['project_estimates.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('optimization_recommendations', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_optimization_recommendations_estimate_id'), ['estimate_id'], unique=False)

    if not _exists('reports'):
        op.create_table('reports',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('project_id', sa.String(length=36), nullable=False),
        sa.Column('owner_id', sa.String(length=36), nullable=False),
        sa.Column('estimate_id', sa.String(length=36), nullable=True),
        sa.Column('file_name', sa.String(length=255), nullable=False),
        sa.Column('storage_key', sa.String(length=255), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('total_cost', sa.Float(), nullable=False),
        sa.Column('currency', sa.String(length=8), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['estimate_id'], ['project_estimates.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        with op.batch_alter_table('reports', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_reports_owner_id'), ['owner_id'], unique=False)
            batch_op.create_index(batch_op.f('ix_reports_project_id'), ['project_id'], unique=False)
    # databases created before the 3D layout feature lack this column
    cols = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('projects')}
    if 'layout' not in cols:
        with op.batch_alter_table('projects', schema=None) as batch_op:
            batch_op.add_column(sa.Column('layout', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('reports', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_reports_project_id'))
        batch_op.drop_index(batch_op.f('ix_reports_owner_id'))

    op.drop_table('reports')
    with op.batch_alter_table('optimization_recommendations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_optimization_recommendations_estimate_id'))

    op.drop_table('optimization_recommendations')
    with op.batch_alter_table('estimate_items', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_estimate_items_estimate_id'))

    op.drop_table('estimate_items')
    with op.batch_alter_table('project_rooms', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_project_rooms_project_id'))

    op.drop_table('project_rooms')
    with op.batch_alter_table('project_estimates', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_project_estimates_project_id'))
        batch_op.drop_index(batch_op.f('ix_project_estimates_owner_id'))

    op.drop_table('project_estimates')
    with op.batch_alter_table('material_price_records', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_material_price_records_owner_id'))
        batch_op.drop_index(batch_op.f('ix_material_price_records_material_id'))

    op.drop_table('material_price_records')
    with op.batch_alter_table('floor_plan_files', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_floor_plan_files_project_id'))
        batch_op.drop_index(batch_op.f('ix_floor_plan_files_owner_id'))

    op.drop_table('floor_plan_files')
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_projects_owner_id'))

    op.drop_table('projects')
    with op.batch_alter_table('materials', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_materials_owner_id'))
        batch_op.drop_index(batch_op.f('ix_materials_estimate_key'))

    op.drop_table('materials')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_email'))

    op.drop_table('users')
