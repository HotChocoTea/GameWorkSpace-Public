pub mod ai;
pub mod assets;
pub mod balance;
pub mod db;
pub mod engine_sync;
pub mod export;
pub mod impact;
pub mod importer;
pub mod integrations;
pub mod localization;
pub mod models;
pub mod repo;
pub mod secrets;
pub mod seeder;
pub mod snapshots;
pub mod tabular;

pub use db::{resolve_data_dir, resolve_default_data_dir, Database, Error, Result};
pub use models::*;
pub const DATABASE_NAME: &str = "gameworkspace.db";

#[cfg(test)]
mod tests;
