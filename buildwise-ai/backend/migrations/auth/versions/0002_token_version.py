"""Per-account token version: logging out (or a security reset) bumps it and every older session token stops working.

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('credentials')}
    if 'token_version' not in cols:
        with op.batch_alter_table('credentials', schema=None) as batch_op:
            batch_op.add_column(sa.Column('token_version', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('credentials', schema=None) as batch_op:
        batch_op.drop_column('token_version')
