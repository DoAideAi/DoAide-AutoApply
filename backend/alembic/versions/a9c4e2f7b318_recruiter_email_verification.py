"""Recruiter email verification: a pre-send deliverability verdict

``recruiters.email_verification`` records whether the address looked
deliverable before anything was composed for it — syntax, a disposable domain,
a previous hard bounce, and whether the domain accepts mail at all — with the
time it was checked and why it failed. ``delivery_state`` beside it still only
learns from bounces; this is the half that runs first.

Non-native VARCHAR enum with no CHECK constraint, per house style. Existing rows
start ``UNVERIFIED`` and are checked the next time anything tries to use them.

Purely additive; the downgrade is a clean reversal.

Revision ID: a9c4e2f7b318
Revises: e1a2b3c4d5f6
Create Date: 2026-10-20
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a9c4e2f7b318"
down_revision: str | None = "e1a2b3c4d5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "recruiters",
        sa.Column(
            "email_verification",
            sa.String(16),
            server_default="UNVERIFIED",
            nullable=False,
        ),
    )
    op.add_column(
        "recruiters",
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "recruiters",
        sa.Column("email_verification_reason", sa.String(255), nullable=True),
    )
    op.create_index(
        op.f("ix_recruiters_email_verification"), "recruiters", ["email_verification"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_recruiters_email_verification"), table_name="recruiters")
    op.drop_column("recruiters", "email_verification_reason")
    op.drop_column("recruiters", "email_verified_at")
    op.drop_column("recruiters", "email_verification")
