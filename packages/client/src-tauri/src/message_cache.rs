use rusqlite::Connection;
use sea_query::{Iden, OnConflict, Query, SqliteQueryBuilder};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Default)]
pub struct CacheDb(Mutex<Option<Connection>>);

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Operation {
    Get { key: String },
    Set { key: String, value: String },
    Remove { key: String },
    Keys,
}

#[derive(Iden)]
enum MessageSnapshots {
    Table,
    Key,
    Value,
}

fn initialize(connection: &Connection) -> rusqlite::Result<()> {
    // Avoid leaving removed message text on SQLite's freelist after logout.
    connection.pragma_update(None, "secure_delete", "ON")?;
    let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == 0 {
        let migration = connection.unchecked_transaction()?;
        migration.execute_batch(include_str!("../cache-migrations/0000_pink_spot.sql"))?;
        migration.pragma_update(None, "user_version", 1)?;
        migration.commit()?;
    }
    Ok(())
}

fn execute(connection: &Connection, operation: Operation) -> rusqlite::Result<Value> {
    use MessageSnapshots::{Key, Table, Value as Data};
    match operation {
        Operation::Get { key } => {
            let query = Query::select()
                .column(Data)
                .from(Table)
                .and_where(sea_query::Expr::col(Key).eq(key))
                .to_string(SqliteQueryBuilder);
            let mut stmt = connection.prepare(&query)?;
            let mut rows = stmt.query([])?;
            Ok(match rows.next()? {
                Some(row) => json!(row.get::<_, String>(0)?),
                None => Value::Null,
            })
        }
        Operation::Set { key, value } => {
            let query = Query::insert()
                .into_table(Table)
                .columns([Key, Data])
                .values_panic([key.into(), value.into()])
                .on_conflict(OnConflict::column(Key).update_column(Data).to_owned())
                .to_string(SqliteQueryBuilder);
            connection.execute(&query, [])?;
            Ok(Value::Null)
        }
        Operation::Remove { key } => {
            let query = Query::delete()
                .from_table(Table)
                .and_where(sea_query::Expr::col(Key).eq(key))
                .to_string(SqliteQueryBuilder);
            connection.execute(&query, [])?;
            Ok(Value::Null)
        }
        Operation::Keys => {
            let query = Query::select()
                .column(Key)
                .from(Table)
                .to_string(SqliteQueryBuilder);
            let mut stmt = connection.prepare(&query)?;
            let keys = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(json!(keys))
        }
    }
}

#[tauri::command]
pub fn message_cache(
    app: tauri::AppHandle,
    state: tauri::State<'_, CacheDb>,
    operation: Operation,
) -> Result<Value, String> {
    let mut guard = state.0.lock().map_err(|_| "Cache lock unavailable")?;
    if guard.is_none() {
        let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let connection =
            Connection::open(directory.join("messages.db")).map_err(|e| e.to_string())?;
        initialize(&connection).map_err(|e| e.to_string())?;
        *guard = Some(connection);
    }
    execute(guard.as_ref().ok_or("Cache unavailable")?, operation).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_lifecycle_and_quoted_keys() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        initialize(&db).unwrap();
        let key = "owner' OR 1=1 --".to_string();
        execute(
            &db,
            Operation::Set {
                key: key.clone(),
                value: "first".into(),
            },
        )
        .unwrap();
        execute(
            &db,
            Operation::Set {
                key: "other".into(),
                value: "private".into(),
            },
        )
        .unwrap();
        execute(
            &db,
            Operation::Set {
                key: key.clone(),
                value: "updated".into(),
            },
        )
        .unwrap();
        assert_eq!(
            execute(&db, Operation::Get { key: key.clone() }).unwrap(),
            json!("updated")
        );
        assert_eq!(
            execute(&db, Operation::Keys)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            2
        );
        execute(&db, Operation::Remove { key: key.clone() }).unwrap();
        assert_eq!(execute(&db, Operation::Get { key }).unwrap(), Value::Null);
        assert_eq!(
            execute(
                &db,
                Operation::Get {
                    key: "other".into()
                }
            )
            .unwrap(),
            json!("private")
        );
    }
}
