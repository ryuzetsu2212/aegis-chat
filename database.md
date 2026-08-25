\# DATABASE SCHEMA (SQLite)



\## Table: users

\- `id` (INTEGER, Primary Key, Auto Increment)

\- `username` (TEXT, Unique, Not Null)

\- `password` (TEXT, Not Null) - Stored as bcrypt hash.



\## Table: messages

\- `id` (INTEGER, Primary Key, Auto Increment)

\- `sender` (TEXT, Not Null)

\- `receiver` (TEXT, Not Null) - Or 'global' if public room.

\- `ciphertext` (TEXT, Not Null) - The AES-256 encrypted message (Base64).

\- `timestamp` (DATETIME, Default CURRENT\_TIMESTAMP)

