# 🧑‍💼 Simulated Banking Backend (Admin Enabled)

Includes admin support to view users, freeze accounts, and delete users.

## Admin Endpoints

- `GET /api/admin/users` – View all users
- `GET /api/admin/transactions` – View all transactions
- `DELETE /api/admin/user/:id` – Delete a user
- `PATCH /api/admin/freeze/:id` – Freeze or unfreeze a user

Requires `Authorization: Bearer <admin-token>` with `role: "admin"`