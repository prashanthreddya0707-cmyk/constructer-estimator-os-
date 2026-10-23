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
    if not _exists('credentials'):
        op.create_table('credentials',
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('email_lookup', sa.String(length=64), nullable=False),
        sa.Column('email_enc', sa.String(length=600), nullable=False),
        sa.Column('name_enc', sa.String(length=600), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('user_id')
        )
        with op.batch_alter_table('credentials', schema=None) as batch_op:
            batch_op.create_index(batch_op.f('ix_credentials_email_lookup'), ['email_lookup'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('credentials', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_credentials_email_lookup'))

    op.drop_table('credentials')
