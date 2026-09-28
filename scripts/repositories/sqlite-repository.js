"use strict";

const { randomUUID } = require("node:crypto");
const { transaction } = require("../database/connection.js");
const { folderPathList } = require("../services/daily-action-service.js");

function ftsQuery(value) {
  return String(value).trim().split(/\s+/).filter(Boolean).slice(0, 8)
    .map((part) => `"${part.replace(/"/g, '""')}"*`).join(" AND ");
}
function validDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false; const date=new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value; }

class SqliteRepository {
  constructor(database) { this.database = database; }

  listTodos(includeCompleted = false) {
    const tags = this.database.prepare("SELECT tag_id AS tagId FROM todo_tags WHERE todo_id = ? ORDER BY tag_id");
    const files = this.database.prepare("SELECT managed_file_id AS id FROM todo_managed_files WHERE todo_id = ? ORDER BY managed_file_id");
    const library = this.database.prepare("SELECT library_item_id AS id FROM todo_library_items WHERE todo_id = ? ORDER BY library_item_id");
    const folders = this.database.prepare("SELECT relative_path AS relativePath FROM todo_folders WHERE todo_id = ? ORDER BY relative_path");
    return this.database.prepare(`SELECT id,title,due_date AS dueDate,progress,created_at AS createdAt,updated_at AS updatedAt,revision,completed_at AS completedAt,deleted_at AS deletedAt FROM todos WHERE ${includeCompleted ? "1=1" : "completed_at IS NULL AND deleted_at IS NULL"} ORDER BY due_date IS NULL,due_date,created_at,id`).all().map((item) => ({ ...item, tagIds: tags.all(item.id).map((tag) => tag.tagId), managedFileIds: files.all(item.id).map((row) => row.id), libraryIds: library.all(item.id).map((row) => row.id), folderPaths: folders.all(item.id).map((row) => row.relativePath) }));
  }

  saveTodo(input, id = null) {
    const folderPaths = folderPathList(input.folderPaths);
    const title = String(input.title || "").trim(), tagIds = [...new Set(input.tagIds || [])], dueDate=String(input.dueDate||"").trim()||null, progress=Number(input.progress??0);
    if (!title || title.length > 300 || tagIds.some((tag) => !/^[A-Za-z0-9_-]+$/.test(tag)) || (dueDate&&!validDate(dueDate)) || !Number.isInteger(progress)||progress<0||progress>99) throw new Error("Todoの名前・タグ・期限日・達成度（0〜99%）を確認してください。");
    const now = new Date().toISOString(), key = id || `todo-${randomUUID()}`;
    transaction(this.database, () => {
      if (id) {
        const result = this.database.prepare("UPDATE todos SET title=?,due_date=?,progress=?,completed_at=CASE WHEN ?=100 THEN coalesce(completed_at,?) ELSE NULL END,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND deleted_at IS NULL").run(title,dueDate,progress,progress,now,now,id,Number(input.revision));
        if (result.changes !== 1) { const error = new Error("Todoが更新されています。再読み込みしてください。"); error.statusCode=409; throw error; }
      } else this.database.prepare("INSERT INTO todos(id,title,due_date,progress,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?)").run(key,title,dueDate,progress,now,now,progress===100?now:null);
      const archivedTags=id?this.database.prepare("SELECT r.tag_id AS tagId FROM todo_tags r JOIN tags t ON t.id=r.tag_id WHERE r.todo_id=? AND t.archived_at IS NOT NULL").all(key).map(row=>row.tagId):[];
      this.database.prepare("DELETE FROM todo_tags WHERE todo_id=?").run(key);
      for (const tag of [...new Set([...tagIds,...archivedTags])]) this.database.prepare("INSERT INTO todo_tags(todo_id,tag_id) VALUES(?,?)").run(key,tag);
      this.database.prepare("DELETE FROM todo_managed_files WHERE todo_id=?").run(key);
      for (const fileId of [...new Set(input.managedFileIds || [])]) this.database.prepare("INSERT INTO todo_managed_files(todo_id,managed_file_id) VALUES(?,?)").run(key,fileId);
      this.database.prepare("DELETE FROM todo_library_items WHERE todo_id=?").run(key);
      for (const libraryId of [...new Set(input.libraryIds || [])]) this.database.prepare("INSERT INTO todo_library_items(todo_id,library_item_id) VALUES(?,?)").run(key,libraryId);
      this.database.prepare("DELETE FROM todo_folders WHERE todo_id=?").run(key);
      for (const folderPath of folderPaths) this.database.prepare("INSERT INTO todo_folders(todo_id,relative_path) VALUES(?,?)").run(key,folderPath);
    });
    return this.listTodos(true).find((item) => item.id === key);
  }

  deleteTodo(id, revision) {
    const now = new Date().toISOString();
    const result=this.database.prepare("UPDATE todos SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND deleted_at IS NULL").run(now,now,id,Number(revision));
    if (result.changes !== 1) throw new Error("Todoが更新されています。再読み込みしてください。");
  }

  createReferencedLibraryItem(itemType, rootId, relativePath) {
    const id=`library-${randomUUID()}`,now=new Date().toISOString();
    this.database.prepare("INSERT INTO library_items(id,item_type,title,authors_json,reading_status,priority,favorite,keywords_json,takeaway_markdown,url,intake_status,review_status,source_root_id,source_relative_path,created_at,updated_at) VALUES(?,?,?,'[]','unread',3,0,'[]','','','uploaded','unverified',?,?,?,?)").run(id,itemType,relativePath.split('/').at(-1).replace(/\.pdf$/i,''),rootId,relativePath,now,now);
    return this.libraryItemById(id);
  }

  dashboard() {
    const totals = this.database.prepare(`
      SELECT
        (SELECT count(*) FROM journal_entries WHERE deleted_at IS NULL) AS journals,
        (SELECT count(DISTINCT entry_date) FROM journal_entries WHERE deleted_at IS NULL) AS active_days,
        (SELECT count(*) FROM activity_events WHERE deleted_at IS NULL) AS activities,
        (SELECT count(*) FROM file_index_items WHERE deleted_at IS NULL AND missing = 0) AS files
    `).get();
    const recent = this.database.prepare("SELECT id, entry_date AS entryDate, title, substr(body_markdown, 1, 180) AS excerpt, updated_at AS updatedAt, revision FROM journal_entries WHERE deleted_at IS NULL ORDER BY entry_date DESC LIMIT 5").all();
    return { totals, recent };
  }

  listTags(includeArchived = false) {
    return this.database.prepare(`
      SELECT t.id, t.category_id AS categoryId, t.name, t.description, t.display_order AS displayOrder,
             c.name AS categoryName, t.revision, t.archived_at AS archivedAt
      FROM tags t LEFT JOIN tag_categories c ON c.id = t.category_id
      WHERE t.deleted_at IS NULL ${includeArchived ? "" : "AND t.archived_at IS NULL"}
      ORDER BY coalesce(c.display_order, 999), t.display_order, t.name
    `).all();
  }

  listTagCategories() {
    return this.database.prepare("SELECT id, name, description, display_order AS displayOrder, revision FROM tag_categories WHERE deleted_at IS NULL ORDER BY display_order, name").all();
  }

  createTag(input) {
    this.database.prepare("INSERT INTO tags(id, category_id, name, description, display_order) VALUES (?, ?, ?, ?, ?)").run(input.id, input.categoryId, input.name, input.description, input.displayOrder);
    return this.database.prepare("SELECT id, category_id AS categoryId, name, description, display_order AS displayOrder FROM tags WHERE id = ?").get(input.id);
  }

  updateTag(id, input) {
    const result = this.database.prepare("UPDATE tags SET name = ?, category_id = ?, description = ?, display_order = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL").run(input.name, input.categoryId, input.description, input.displayOrder, id, input.revision);
    if (Number(result.changes) !== 1) { const error = new Error("タグが別の画面で更新されました。再読み込みしてください。"); error.statusCode = 409; throw error; }
    return this.listTags().find((item) => item.id === id);
  }

  setTagArchived(id, archived, revision) {
    const value=archived?new Date().toISOString():null;
    const result=this.database.prepare("UPDATE tags SET archived_at=?,revision=revision+1 WHERE id=? AND revision=? AND deleted_at IS NULL").run(value,id,Number(revision));
    if(result.changes!==1){const error=new Error("タグが別の画面で更新されました。再読み込みしてください。");error.statusCode=409;throw error;}
    return this.listTags(true).find(item=>item.id===id);
  }

  createTagCategory(input) {
    this.database.prepare("INSERT INTO tag_categories(id, name, description, display_order) VALUES (?, ?, ?, ?)").run(input.id, input.name, input.description, input.displayOrder);
    return this.listTagCategories().find((item) => item.id === input.id);
  }

  updateTagCategory(id, input) {
    const result = this.database.prepare("UPDATE tag_categories SET name = ?, description = ?, display_order = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL").run(input.name, input.description, input.displayOrder, id, input.revision);
    if (Number(result.changes) !== 1) { const error = new Error("タグ分類が別の画面で更新されました。再読み込みしてください。"); error.statusCode = 409; throw error; }
    return this.listTagCategories().find((item) => item.id === id);
  }

  listProjects() {
    return this.database.prepare("SELECT id, name, description, display_order AS displayOrder, archived, revision FROM projects WHERE deleted_at IS NULL ORDER BY archived, display_order, name").all();
  }

  createProject(input) {
    const now = new Date().toISOString();
    const id = input.id || `project-${randomUUID()}`;
    this.database.prepare("INSERT INTO projects(id, name, description, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, input.name, input.description, input.displayOrder, now, now);
    return this.database.prepare("SELECT id, name, description, display_order AS displayOrder, archived, revision FROM projects WHERE id = ?").get(id);
  }

  listLibraryItems(itemType) {
    const tags = this.database.prepare("SELECT tag_id AS tagId FROM library_item_tags WHERE library_item_id = ? ORDER BY tag_id");
    return this.database.prepare("SELECT id, item_type AS itemType, title, authors_json AS authorsJson, publication_year AS year, publication, reading_status AS storedStatus, review_status AS reviewStatus, priority, favorite, keywords_json AS keywordsJson, doi, bibtex_code AS bibtexCode, takeaway_markdown AS takeawayMarkdown, url, intake_status AS intakeStatus, source_upload_id AS sourceUploadId, source_root_id AS sourceRootId, source_relative_path AS sourceRelativePath, cover_upload_id AS coverUploadId, created_at AS createdAt, updated_at AS updatedAt, revision FROM library_items WHERE item_type = ? AND deleted_at IS NULL ORDER BY favorite DESC, CASE review_status WHEN 'unverified' THEN 0 ELSE 1 END, CASE reading_status WHEN 'reading' THEN 1 WHEN 'unread' THEN 2 WHEN 'read' THEN 3 ELSE 4 END, priority DESC, title").all(itemType).map((row) => { const item = { ...row, status: row.reviewStatus === 'unverified' ? 'unverified' : row.storedStatus, favorite: Boolean(row.favorite), authors: JSON.parse(row.authorsJson), keywords: JSON.parse(row.keywordsJson), tagIds: tags.all(row.id).map((tag) => tag.tagId) }; delete item.authorsJson; delete item.keywordsJson; delete item.storedStatus; return item; });
  }

  listLibraryAuthors() {
    const names = new Set();
    for (const row of this.database.prepare("SELECT authors_json AS authorsJson FROM library_items WHERE deleted_at IS NULL").all()) {
      try { for (const name of JSON.parse(row.authorsJson)) if (String(name).trim()) names.add(String(name).trim()); } catch { /* 古い不正データは候補から除外 */ }
    }
    return [...names].sort((a,b)=>a.localeCompare(b,"ja"));
  }

  libraryItemById(id) {
    const row = this.database.prepare("SELECT id, item_type AS itemType, title, authors_json AS authorsJson, publication_year AS year, publication, reading_status AS storedStatus, review_status AS reviewStatus, priority, favorite, keywords_json AS keywordsJson, doi, bibtex_code AS bibtexCode, takeaway_markdown AS takeawayMarkdown, url, intake_status AS intakeStatus, source_upload_id AS sourceUploadId, source_root_id AS sourceRootId, source_relative_path AS sourceRelativePath, cover_upload_id AS coverUploadId, created_at AS createdAt, updated_at AS updatedAt, revision FROM library_items WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!row) return null;
    row.favorite = Boolean(row.favorite);
    row.status = row.reviewStatus === "unverified" ? "unverified" : row.storedStatus; delete row.storedStatus;
    row.authors = JSON.parse(row.authorsJson); delete row.authorsJson;
    row.keywords = JSON.parse(row.keywordsJson); delete row.keywordsJson;
    row.tagIds = this.database.prepare("SELECT tag_id AS tagId FROM library_item_tags WHERE library_item_id = ? ORDER BY tag_id").all(id).map((item) => item.tagId);
    row.journalIds = this.database.prepare("SELECT journal_id AS journalId FROM library_item_journals WHERE library_item_id = ? ORDER BY journal_id").all(id).map((item) => item.journalId);
    return row;
  }

  replaceLibraryRelations(id, input) {
    const archivedTags=this.database.prepare("SELECT r.tag_id AS tagId FROM library_item_tags r JOIN tags t ON t.id=r.tag_id WHERE r.library_item_id=? AND t.archived_at IS NOT NULL").all(id).map(row=>row.tagId);
    this.database.prepare("DELETE FROM library_item_tags WHERE library_item_id = ?").run(id);
    const addTag = this.database.prepare("INSERT INTO library_item_tags(library_item_id, tag_id) VALUES (?, ?)");
    for (const tagId of [...new Set([...input.tagIds,...archivedTags])]) addTag.run(id, tagId);
    this.database.prepare("DELETE FROM library_item_journals WHERE library_item_id = ?").run(id);
    const addJournal = this.database.prepare("INSERT INTO library_item_journals(library_item_id, journal_id) VALUES (?, ?)");
    for (const journalId of input.journalIds) addJournal.run(id, journalId);
  }

  createLibraryItem(input) {
    const id = `library-${randomUUID()}`, now = new Date().toISOString();
    transaction(this.database, () => {
      const reviewStatus=input.status === "unverified" ? "unverified" : "confirmed", storedStatus=input.status === "unverified" ? "unread" : input.status;
      this.database.prepare("INSERT INTO library_items(id, item_type, title, authors_json, publication_year, publication, reading_status, review_status, priority, favorite, keywords_json, doi, bibtex_code, takeaway_markdown, url, intake_status, cover_upload_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)").run(id, input.itemType, input.title, JSON.stringify(input.authors), input.year, input.publication, storedStatus, reviewStatus, input.priority, input.favorite ? 1 : 0, JSON.stringify(input.keywords || []), input.doi || "", input.bibtexCode || "", input.takeawayMarkdown, input.url, input.coverUploadId || null, now, now);
      this.replaceLibraryRelations(id, input);
      this.database.prepare("UPDATE library_items SET source_root_id = ?, source_relative_path = ? WHERE id = ?").run(input.sourceRootId || null, input.sourceRelativePath || null, id);
    });
    return this.libraryItemById(id);
  }

  updateLibraryItem(id, input) {
    const now = new Date().toISOString();
    transaction(this.database, () => {
      const reviewStatus=input.status === "unverified" ? "unverified" : "confirmed", storedStatus=input.status === "unverified" ? "unread" : input.status;
      const result = this.database.prepare("UPDATE library_items SET item_type = ?, title = ?, authors_json = ?, publication_year = ?, publication = ?, reading_status = ?, review_status = ?, priority = ?, favorite = ?, keywords_json = ?, doi = ?, bibtex_code = ?, takeaway_markdown = ?, url = ?, intake_status = 'ready', cover_upload_id = coalesce(?, cover_upload_id), updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL").run(input.itemType, input.title, JSON.stringify(input.authors), input.year, input.publication, storedStatus, reviewStatus, input.priority, input.favorite ? 1 : 0, JSON.stringify(input.keywords || []), input.doi || "", input.bibtexCode || "", input.takeawayMarkdown, input.url, input.coverUploadId || null, now, id, input.revision);
      if (Number(result.changes) !== 1) { const error = new Error("資料が別の画面で更新されました。再読み込みしてください。"); error.statusCode = 409; throw error; }
      this.replaceLibraryRelations(id, input);
      this.database.prepare("UPDATE library_items SET source_root_id = ?, source_relative_path = ? WHERE id = ?").run(input.sourceRootId || null, input.sourceRelativePath || null, id);
    });
    return this.libraryItemById(id);
  }

  deleteLibraryItem(id, revision) {
    const now = new Date().toISOString();
    const result = this.database.prepare("UPDATE library_items SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL").run(now, now, id, revision);
    if (Number(result.changes) !== 1) { const error = new Error("資料を削除できません。再読み込みしてください。"); error.statusCode = 409; throw error; }
  }

  createUploadedLibraryItem(itemType, uploadId, originalName) {
    const id = `library-${randomUUID()}`, now = new Date().toISOString();
    const title = String(originalName || "PDF").replace(/\.pdf$/i, "").slice(0, 500) || "PDF";
    this.database.prepare("INSERT INTO library_items(id, item_type, title, authors_json, reading_status, review_status, priority, favorite, keywords_json, takeaway_markdown, url, intake_status, source_upload_id, created_at, updated_at) VALUES (?, ?, ?, '[]', 'unread', 'unverified', 3, 0, '[]', '', '', 'uploaded', ?, ?, ?)").run(id, itemType, title, uploadId, now, now);
    return this.libraryItemById(id);
  }

  createManagedUpload(input) {
    this.database.prepare("INSERT INTO managed_uploads(id, stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(input.id, input.storedName, input.originalName, input.mimeType, input.sizeBytes, input.createdAt);
    return this.managedUploadById(input.id);
  }

  managedUploadById(id) {
    return this.database.prepare("SELECT id, stored_name AS storedName, original_name AS originalName, mime_type AS mimeType, size_bytes AS sizeBytes, created_at AS createdAt FROM managed_uploads WHERE id = ? AND deleted_at IS NULL").get(id) || null;
  }

  listLibraryTrash() {
    return this.database.prepare("SELECT id, item_type AS itemType, title, publication_year AS year, updated_at AS updatedAt, revision, deleted_at AS deletedAt FROM library_items WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all();
  }

  restoreLibraryItem(id, revision) {
    const now = new Date().toISOString();
    const result = this.database.prepare("UPDATE library_items SET deleted_at = NULL, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NOT NULL").run(now, id, revision);
    if (Number(result.changes) !== 1) { const error = new Error("資料を復元できません。再読み込みしてください。"); error.statusCode = 409; throw error; }
    return this.libraryItemById(id);
  }

  purgeLibraryItem(id, revision) {
    const result = this.database.prepare("DELETE FROM library_items WHERE id = ? AND revision = ? AND deleted_at IS NOT NULL").run(id, revision);
    if (Number(result.changes) !== 1) { const error = new Error("資料を完全削除できません。再読み込みしてください。"); error.statusCode = 409; throw error; }
  }

  listJournals({ query = "", tagId = "", limit = 100, offset = 0, includeDeleted = false } = {}) {
    const where = [includeDeleted ? "1=1" : "j.deleted_at IS NULL"];
    const params = [];
    let join = "";
    if (query.trim()) { join += " JOIN journal_fts f ON f.journal_id = j.id"; where.push("journal_fts MATCH ?"); params.push(ftsQuery(query)); }
    if (tagId) { join += " JOIN journal_tags filter_tag ON filter_tag.journal_id = j.id"; where.push("filter_tag.tag_id = ?"); params.push(tagId); }
    params.push(Math.min(250, Math.max(1, limit)), Math.max(0, offset));
    const rows = this.database.prepare(`SELECT DISTINCT j.id, j.entry_date AS entryDate, j.title, substr(j.body_markdown, 1, 240) AS excerpt, j.created_at AS createdAt, j.updated_at AS updatedAt, j.revision, j.deleted_at AS deletedAt FROM journal_entries j ${join} WHERE ${where.join(" AND ")} ORDER BY j.entry_date DESC LIMIT ? OFFSET ?`).all(...params);
    const tags = this.database.prepare("SELECT tag_id AS tagId FROM journal_tags WHERE journal_id = ? ORDER BY tag_id");
    return rows.map((row) => ({ ...row, tagIds: tags.all(row.id).map((item) => item.tagId) }));
  }

  journalById(id, includeDeleted = false) {
    const journal = this.database.prepare(`SELECT id, entry_date AS entryDate, title, body_markdown AS bodyMarkdown, created_at AS createdAt, updated_at AS updatedAt, revision, deleted_at AS deletedAt FROM journal_entries WHERE id = ? ${includeDeleted ? "" : "AND deleted_at IS NULL"}`).get(id);
    if (!journal) return null;
    journal.tagIds = this.database.prepare("SELECT tag_id AS tagId FROM journal_tags WHERE journal_id = ? ORDER BY tag_id").all(id).map((row) => row.tagId);
    journal.projectIds = this.database.prepare("SELECT project_id AS projectId FROM journal_projects WHERE journal_id = ? ORDER BY project_id").all(id).map((row) => row.projectId);
    journal.files = this.database.prepare("SELECT id, root_id AS rootId, relative_path AS relativePath, target_type AS targetType, display_name AS displayName, note, display_order AS displayOrder FROM file_links WHERE journal_id = ? ORDER BY display_order, id").all(id);
    return journal;
  }

  journalByDate(entryDate) {
    const row = this.database.prepare("SELECT id FROM journal_entries WHERE entry_date = ? AND deleted_at IS NULL").get(entryDate);
    return row ? this.journalById(row.id) : null;
  }

  createJournal(input) {
    const id = input.id || `journal-${randomUUID()}`;
    const now = new Date().toISOString();
    transaction(this.database, () => {
      this.database.prepare("INSERT INTO journal_entries(id, entry_date, title, body_markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, input.entryDate, input.title, input.bodyMarkdown, now, now);
      this.replaceJournalRelations(id, input, now);
    });
    return this.journalById(id);
  }

  updateJournal(id, input) {
    const now = new Date().toISOString();
    transaction(this.database, () => {
      const result = this.database.prepare("UPDATE journal_entries SET entry_date = ?, title = ?, body_markdown = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL").run(input.entryDate, input.title, input.bodyMarkdown, now, id, input.revision);
      if (Number(result.changes) !== 1) { const error = new Error("別の画面で更新されたか、日記が存在しません。再読み込みしてください。"); error.statusCode = 409; throw error; }
      this.replaceJournalRelations(id, input, now);
    });
    return this.journalById(id);
  }

  replaceJournalRelations(id, input, now) {
    const archivedTags=this.database.prepare("SELECT r.tag_id AS tagId FROM journal_tags r JOIN tags t ON t.id=r.tag_id WHERE r.journal_id=? AND t.archived_at IS NOT NULL").all(id).map(row=>row.tagId);
    this.database.prepare("DELETE FROM journal_tags WHERE journal_id = ?").run(id);
    const addTag = this.database.prepare("INSERT INTO journal_tags(journal_id, tag_id) VALUES (?, ?)");
    for (const tagId of [...new Set([...input.tagIds,...archivedTags])]) addTag.run(id, tagId);
    this.database.prepare("DELETE FROM journal_projects WHERE journal_id = ?").run(id);
    const addProject = this.database.prepare("INSERT INTO journal_projects(journal_id, project_id) VALUES (?, ?)");
    for (const projectId of input.projectIds) addProject.run(id, projectId);
    this.database.prepare("DELETE FROM file_links WHERE journal_id = ?").run(id);
    const addFile = this.database.prepare("INSERT INTO file_links(id, journal_id, root_id, relative_path, target_type, display_name, note, display_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    input.files.forEach((file, index) => addFile.run(file.id || `file-${randomUUID()}`, id, file.rootId, file.relativePath, file.targetType, file.displayName, file.note, index + 1, now));
  }

  deleteJournal(id, revision) {
    const result = this.database.prepare("UPDATE journal_entries SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL").run(new Date().toISOString(), new Date().toISOString(), id, revision);
    if (Number(result.changes) !== 1) { const error = new Error("日記を削除できません。再読み込みしてください。"); error.statusCode = 409; throw error; }
  }

  listTrash() {
    const journals = this.database.prepare("SELECT id, 'journal' AS entityType, entry_date AS displayDate, title, updated_at AS updatedAt, revision, deleted_at AS deletedAt FROM journal_entries WHERE deleted_at IS NOT NULL").all();
    const library = this.listLibraryTrash().map((item) => ({ ...item, entityType: "library", displayDate: item.year ? String(item.year) : "" }));
    return [...journals, ...library].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  }

  restoreJournal(id, revision) {
    const now = new Date().toISOString();
    const result = this.database.prepare("UPDATE journal_entries SET deleted_at = NULL, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NOT NULL").run(now, id, revision);
    if (Number(result.changes) !== 1) { const error = new Error("日記を復元できません。再読み込みしてください。"); error.statusCode = 409; throw error; }
    return this.journalById(id);
  }

  purgeJournal(id, revision) {
    const result = this.database.prepare("DELETE FROM journal_entries WHERE id = ? AND revision = ? AND deleted_at IS NOT NULL").run(id, revision);
    if (Number(result.changes) !== 1) { const error = new Error("日記を完全削除できません。再読み込みしてください。"); error.statusCode = 409; throw error; }
  }

  listDailyActions({ date = "", from = "", to = "", limit = 500 } = {}) {
    const where = ["a.deleted_at IS NULL"], params = [];
    if (date) { where.push("a.action_date = ?"); params.push(date); }
    if (from) { where.push("a.action_date >= ?"); params.push(from); }
    if (to) { where.push("a.action_date <= ?"); params.push(to); }
    params.push(Math.min(2000, Math.max(1, Number(limit) || 500)));
    const tags = this.database.prepare("SELECT tag_id AS tagId FROM daily_action_tags WHERE daily_action_id = ? ORDER BY tag_id");
    const completions = this.database.prepare("SELECT content FROM daily_action_completions WHERE daily_action_id = ? ORDER BY display_order, id");
    const files = this.database.prepare("SELECT file_index_item_id AS id FROM daily_action_file_items WHERE daily_action_id = ? ORDER BY file_index_item_id");
    const managedFiles = this.database.prepare("SELECT managed_file_id AS id FROM daily_action_managed_files WHERE daily_action_id = ? ORDER BY managed_file_id");
    const library = this.database.prepare("SELECT library_item_id AS id FROM daily_action_library_items WHERE daily_action_id = ? ORDER BY library_item_id");
    const folders = this.database.prepare("SELECT relative_path AS relativePath FROM daily_action_folders WHERE daily_action_id = ? ORDER BY relative_path");
    const uploads = this.database.prepare("SELECT u.id, u.original_name AS originalName, u.mime_type AS mimeType, u.size_bytes AS sizeBytes FROM daily_action_uploads a JOIN managed_uploads u ON u.id = a.upload_id WHERE a.daily_action_id = ? AND u.deleted_at IS NULL ORDER BY u.created_at");
    return this.database.prepare(`
      SELECT a.id, a.action_date AS actionDate, a.start_time AS startTime, a.end_time AS endTime,
             a.action, a.location, a.progress, a.finished_at AS finishedAt, a.todo_id AS todoId, a.display_order AS displayOrder,
             coalesce(a.planned_start_time,a.start_time) AS plannedStartTime,
             coalesce(a.planned_end_time,a.end_time) AS plannedEndTime,
             a.actual_start_time AS actualStartTime, a.actual_end_time AS actualEndTime,
             a.target_end_time AS targetEndTime, a.execution_status AS executionStatus, a.completion_flow_enabled AS completionFlowEnabled,
             a.created_at AS createdAt, a.updated_at AS updatedAt, a.revision
      FROM daily_actions a
      WHERE ${where.join(" AND ")}
      ORDER BY a.action_date DESC, a.start_time, a.display_order, a.id
      LIMIT ?
    `).all(...params).map((item) => ({
      ...item,
      tagIds: tags.all(item.id).map((row) => row.tagId),
      completions: completions.all(item.id).map((row) => row.content),
      fileIds: files.all(item.id).map((row) => row.id),
      managedFileIds: managedFiles.all(item.id).map((row) => row.id),
      libraryIds: library.all(item.id).map((row) => row.id),
      uploads: uploads.all(item.id),
      uploadIds: uploads.all(item.id).map((row) => row.id),
      folderPaths: folders.all(item.id).map((row) => row.relativePath),
    }));
  }

  dailyActionById(id) {
    const row = this.database.prepare("SELECT action_date AS actionDate FROM daily_actions WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!row) return null;
    return this.listDailyActions({ date: row.actionDate, limit: 2000 }).find((item) => item.id === id) || null;
  }

  replaceDailyActionRelations(id, input) {
    this.database.prepare("UPDATE daily_actions SET todo_id = ? WHERE id = ?").run(input.todoId || null, id);
    if (input.todoId) {
      const now=new Date().toISOString();
      this.database.prepare("UPDATE todos SET progress=?,completed_at=CASE WHEN ?=100 THEN coalesce(completed_at,?) ELSE NULL END,updated_at=?,revision=revision+1 WHERE id=? AND deleted_at IS NULL").run(input.progress,input.progress,now,now,input.todoId);
    }
    const archivedTags=this.database.prepare("SELECT r.tag_id AS tagId FROM daily_action_tags r JOIN tags t ON t.id=r.tag_id WHERE r.daily_action_id=? AND t.archived_at IS NOT NULL").all(id).map(row=>row.tagId);
    this.database.prepare("DELETE FROM daily_action_tags WHERE daily_action_id = ?").run(id);
    const addTag = this.database.prepare("INSERT INTO daily_action_tags(daily_action_id, tag_id) VALUES (?, ?)");
    for (const tagId of [...new Set([...input.tagIds,...archivedTags])]) addTag.run(id, tagId);
    this.database.prepare("DELETE FROM daily_action_completions WHERE daily_action_id = ?").run(id);
    const addCompletion = this.database.prepare("INSERT INTO daily_action_completions(id, daily_action_id, content, display_order) VALUES (?, ?, ?, ?)");
    input.completions.forEach((content, index) => addCompletion.run(`completion-${randomUUID()}`, id, content, index + 1));
    this.database.prepare("DELETE FROM daily_action_file_items WHERE daily_action_id = ?").run(id);
    const addFile = this.database.prepare("INSERT INTO daily_action_file_items(daily_action_id, file_index_item_id) VALUES (?, ?)");
    for (const fileId of input.fileIds || []) addFile.run(id, fileId);
    this.database.prepare("DELETE FROM daily_action_managed_files WHERE daily_action_id = ?").run(id);
    const addManagedFile = this.database.prepare("INSERT INTO daily_action_managed_files(daily_action_id, managed_file_id) VALUES (?, ?)");
    for (const fileId of input.managedFileIds || []) addManagedFile.run(id, fileId);
    this.database.prepare("DELETE FROM daily_action_library_items WHERE daily_action_id = ?").run(id);
    const addLibrary = this.database.prepare("INSERT INTO daily_action_library_items(daily_action_id, library_item_id) VALUES (?, ?)");
    for (const libraryId of input.libraryIds || []) addLibrary.run(id, libraryId);
    this.database.prepare("DELETE FROM daily_action_uploads WHERE daily_action_id = ?").run(id);
    const addUpload = this.database.prepare("INSERT INTO daily_action_uploads(daily_action_id, upload_id) VALUES (?, ?)");
    for (const uploadId of input.uploadIds || []) addUpload.run(id, uploadId);
    this.database.prepare("DELETE FROM daily_action_folders WHERE daily_action_id = ?").run(id);
    const addFolder = this.database.prepare("INSERT INTO daily_action_folders(daily_action_id, relative_path) VALUES (?, ?)");
    for (const folderPath of input.folderPaths || []) addFolder.run(id, folderPath);
  }

  createDailyAction(input) {
    const id = `action-${randomUUID()}`, now = new Date().toISOString();
    transaction(this.database, () => {
      this.database.prepare("INSERT INTO daily_actions(id, action_date, start_time, end_time, planned_start_time, planned_end_time, action, location, progress, display_order, created_at, updated_at, completion_flow_enabled, execution_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'planned')").run(id, input.actionDate, input.startTime, input.endTime, input.startTime, input.endTime, input.action, input.location, input.progress, input.displayOrder, now, now);
      this.replaceDailyActionRelations(id, input);
    });
    return this.dailyActionById(id);
  }

  updateDailyAction(id, input) {
    const now = new Date().toISOString();
    return transaction(this.database, () => {
      const result = this.database.prepare("UPDATE daily_actions SET action_date = ?, start_time = ?, end_time = ?, planned_start_time = ?, planned_end_time = ?, action = ?, location = ?, progress = ?, display_order = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL").run(input.actionDate, input.startTime, input.endTime, input.startTime, input.endTime, input.action, input.location, input.progress, input.displayOrder, now, id, input.revision);
      if (Number(result.changes) !== 1) { const error = new Error("アクションが別の画面で更新されました。再読み込みしてください。"); error.statusCode = 409; throw error; }
      this.replaceDailyActionRelations(id, input);
      return this.dailyActionById(id);
    });
  }

  deleteDailyAction(id, revision) {
    const now = new Date().toISOString();
    const result = this.database.prepare("UPDATE daily_actions SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL").run(now, now, id, revision);
    if (Number(result.changes) !== 1) { const error = new Error("アクションを削除できません。再読み込みしてください。"); error.statusCode = 409; throw error; }
  }

  listOverdueActions(now=new Date()) {
    const {dateKey,timeKey}=require('../services/timer-service.js'),date=dateKey(now),time=timeKey(now);
    return this.listDailyActions({limit:2000})
      .filter(item=>item.completionFlowEnabled&&['planned','in_progress'].includes(item.executionStatus)&&(item.actionDate<date||(item.actionDate===date&&(item.executionStatus==='in_progress'?(item.targetEndTime||item.endTime):item.endTime)<=time)))
      .sort((a,b)=>a.actionDate.localeCompare(b.actionDate)||a.startTime.localeCompare(b.startTime)||a.displayOrder-b.displayOrder);
  }

  startDailyAction(id, revision, actualStartTime, targetEndTime, now = new Date()) {
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(actualStartTime||'')))throw new Error('実績開始時刻を確認してください。');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(targetEndTime||''))||actualStartTime>=targetEndTime)throw new Error('目標終了時刻を確認してください。');
    const result=this.database.prepare("UPDATE daily_actions SET actual_start_time=?,actual_end_time=NULL,target_end_time=?,execution_status='in_progress',finished_at=NULL,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND deleted_at IS NULL AND execution_status='planned'").run(actualStartTime,targetEndTime,now.toISOString(),id,Number(revision));
    if(result.changes!==1){const error=new Error('アクションが更新されています。再読み込みしてください。');error.statusCode=409;throw error;}
    return this.dailyActionById(id);
  }

  resolveDailyAction(id, input, revision, now = new Date()) {
    const outcome=String(input?.outcome||'completed');
    if(!['completed','in_progress','skipped'].includes(outcome))throw new Error('実行結果を選択してください。');
    const progress=Number(typeof input==='object'?input.progress:input);
    if (!Number.isInteger(progress) || progress<0 || progress>100) throw new Error('達成度は0〜100で指定してください。');
    const item=this.dailyActionById(id);
    const {dateKey,timeKey}=require('../services/timer-service.js');
    if(!item||item.actionDate>dateKey(now)||(item.actionDate===dateKey(now)&&item.startTime>timeKey(now))||['completed','skipped'].includes(item.executionStatus)) throw new Error('確認できるアクションを確認してください。');
    const validTime=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||''));
    const actualStartTime=String(input?.actualStartTime||item.actualStartTime||item.startTime);
    const actualEndTime=String(input?.actualEndTime||timeKey(now));
    if(outcome!=='skipped'&&!validTime(actualStartTime))throw new Error('実績開始時刻を確認してください。');
    if(outcome==='completed'&&(!validTime(actualEndTime)||actualStartTime>=actualEndTime))throw new Error('実績終了時刻は開始時刻より後にしてください。');
    return transaction(this.database,()=>{
      const finished=outcome==='completed'||outcome==='skipped'?now.toISOString():null;
      const result=this.database.prepare('UPDATE daily_actions SET actual_start_time=?,actual_end_time=?,execution_status=?,progress=?,finished_at=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND execution_status NOT IN (\'completed\',\'skipped\')').run(outcome==='skipped'?null:actualStartTime,outcome==='completed'?actualEndTime:null,outcome,progress,finished,now.toISOString(),id,Number(revision));
      if(result.changes!==1){const error=new Error('アクションが更新されています。再読み込みしてください。');error.statusCode=409;throw error;}
      if(input&&typeof input==='object'&&input.note)this.database.prepare('INSERT INTO daily_action_completions(id,daily_action_id,content,display_order) VALUES(?,?,?,coalesce((SELECT max(display_order)+1 FROM daily_action_completions WHERE daily_action_id=?),1))').run(`completion-${randomUUID()}`,id,input.note,id);
      const continueAsTodo=Boolean(input&&typeof input==='object'&&input.continueAsTodo);
      const dueDate=input&&typeof input==='object'&&validDate(input.dueDate)?input.dueDate:dateKey(now);
      if(item.todoId){
        this.database.prepare('UPDATE todos SET progress=?,due_date=CASE WHEN ? THEN ? ELSE due_date END,completed_at=CASE WHEN ?=100 OR ?=0 THEN ? ELSE NULL END,updated_at=?,revision=revision+1 WHERE id=? AND deleted_at IS NULL').run(progress,continueAsTodo?1:0,dueDate,progress,continueAsTodo?1:0,now.toISOString(),now.toISOString(),item.todoId);
      } else if(progress<100&&continueAsTodo) {
        const todoId=`todo-${randomUUID()}`;
        this.database.prepare('INSERT INTO todos(id,title,due_date,progress,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(todoId,item.action,dueDate,progress,now.toISOString(),now.toISOString());
        for(const tagId of item.tagIds)this.database.prepare('INSERT INTO todo_tags(todo_id,tag_id) VALUES(?,?)').run(todoId,tagId);
        for(const fileId of item.managedFileIds||[])this.database.prepare('INSERT INTO todo_managed_files(todo_id,managed_file_id) VALUES(?,?)').run(todoId,fileId);
        for(const libraryId of item.libraryIds||[])this.database.prepare('INSERT INTO todo_library_items(todo_id,library_item_id) VALUES(?,?)').run(todoId,libraryId);
        for(const folderPath of item.folderPaths||[])this.database.prepare('INSERT INTO todo_folders(todo_id,relative_path) VALUES(?,?)').run(todoId,folderPath);
        this.database.prepare('UPDATE daily_actions SET todo_id=? WHERE id=?').run(todoId,id);
      }
      return this.dailyActionById(id);
    });
  }

  completeDailyAction(id, input, revision, now = new Date()) {
    const item=this.dailyActionById(id),{timeKey}=require('../services/timer-service.js');
    const value=input&&typeof input==='object'?input:{progress:Number(input)};
    return this.resolveDailyAction(id,{...value,outcome:'completed',actualStartTime:value.actualStartTime||item?.actualStartTime||item?.startTime,actualEndTime:value.actualEndTime||timeKey(now)},revision,now);
  }

  // メモはPopNote!のDBの写し（popnote-memos.js）。本体からは読むだけ。
  listMemos({ query = "", limit = 200, from = "", to = "" } = {}) {
    const where = ["m.deleted_at IS NULL"], params = [];
    // from・toは作成日時（UTCのISO形式）の範囲。カレンダーの1か月分などを取り出す。
    if (from) { where.push("m.created_at >= ?"); params.push(from); }
    if (to) { where.push("m.created_at < ?"); params.push(to); }
    if (query.trim()) {
      for (const part of query.trim().split(/\s+/).slice(0, 8)) {
        const like = `%${part.replace(/[\\%_]/g, "\\$&")}%`;
        where.push("(m.title LIKE ? ESCAPE '\\' OR m.body_text LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM memo_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.memo_id = m.id AND t.name LIKE ? ESCAPE '\\'))");
        params.push(like, like, like);
      }
    }
    params.push(Math.min(1000, Math.max(1, limit)));
    const tags = this.database.prepare("SELECT tag_id AS tagId FROM memo_tags WHERE memo_id = ? ORDER BY tag_id");
    return this.database.prepare(`SELECT m.id, m.title, substr(m.body_text, 1, 240) AS excerpt, m.created_at AS createdAt, m.updated_at AS updatedAt, m.revision FROM memos m WHERE ${where.join(" AND ")} ORDER BY m.updated_at DESC LIMIT ?`).all(...params)
      .map((row) => ({ ...row, tagIds: tags.all(row.id).map((item) => item.tagId) }));
  }

  timeline(limit = 150) { const rows = this.database.prepare("SELECT id, occurred_at AS occurredAt, event_type AS eventType, title, description FROM timeline_view ORDER BY occurred_at DESC LIMIT ?").all(Math.min(500, Math.max(1, limit))); return this.withTimelineTags(rows); }

  withTimelineTags(rows) {
    const tags = { journal: this.database.prepare("SELECT tag_id AS tagId FROM journal_tags WHERE journal_id = ? ORDER BY tag_id"), memo: this.database.prepare("SELECT tag_id AS tagId FROM memo_tags WHERE memo_id = ? ORDER BY tag_id") };
    return rows.map((row) => ({ ...row, tagIds: tags[row.eventType] ? tags[row.eventType].all(row.id).map((item) => item.tagId) : [] }));
  }

  calendarMonth(month) {
    const rows = this.database.prepare("SELECT id, occurred_at AS occurredAt, event_type AS eventType, title, description FROM timeline_view WHERE substr(occurred_at, 1, 7) = ? ORDER BY occurred_at").all(month); return this.withTimelineTags(rows);
  }

  dailyAnalysis(date) {
    const row=this.database.prepare("SELECT analysis_date AS analysisDate,source_fingerprint AS sourceFingerprint,llm_summary AS llmSummary,llm_insights_json AS llmInsightsJson,llm_suggestions_json AS llmSuggestionsJson,model_path AS modelPath,analyzed_at AS analyzedAt,revision FROM daily_analyses WHERE analysis_date=?").get(date);
    if(!row)return null;
    const item={...row,llmInsights:JSON.parse(row.llmInsightsJson),llmSuggestions:JSON.parse(row.llmSuggestionsJson)};
    delete item.llmInsightsJson;delete item.llmSuggestionsJson;return item;
  }

  saveDailyAnalysis(date,input) {
    const previous=this.dailyAnalysis(date),revision=(previous?.revision||0)+1;
    this.database.prepare("INSERT INTO daily_analyses(analysis_date,source_fingerprint,llm_summary,llm_insights_json,llm_suggestions_json,model_path,analyzed_at,revision) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(analysis_date) DO UPDATE SET source_fingerprint=excluded.source_fingerprint,llm_summary=excluded.llm_summary,llm_insights_json=excluded.llm_insights_json,llm_suggestions_json=excluded.llm_suggestions_json,model_path=excluded.model_path,analyzed_at=excluded.analyzed_at,revision=excluded.revision").run(date,input.sourceFingerprint,String(input.llmSummary||''),JSON.stringify(input.llmInsights||[]),JSON.stringify(input.llmSuggestions||[]),String(input.modelPath||''),new Date().toISOString(),revision);
    return this.dailyAnalysis(date);
  }

  workTree(limit = 2000) {
    return this.database.prepare(`
      SELECT j.id, j.entry_date AS entryDate, j.title,
             coalesce(group_concat(jt.tag_id, char(31)), '') AS joinedTags
      FROM journal_entries j
      LEFT JOIN journal_tags jt ON jt.journal_id = j.id
      WHERE j.deleted_at IS NULL
      GROUP BY j.id
      ORDER BY j.entry_date DESC
      LIMIT ?
    `).all(Math.min(5000, Math.max(1, limit))).map(({ joinedTags, ...row }) => ({ ...row, tagIds: joinedTags ? joinedTags.split(String.fromCharCode(31)) : [] }));
  }

  listFiles(limit = 500, offset = 0) {
    const rows = this.database.prepare(`
      SELECT * FROM (
        SELECT m.id, 'managed' AS sourceType, m.root_id AS rootId, m.relative_path AS relativePath,
               NULL AS uploadId, m.name, m.extension, NULL AS indexedAt,
               m.created_at AS createdAt, m.revision AS metadataRevision,
               coalesce((SELECT group_concat(tag_id, char(31)) FROM (
                 SELECT dat.tag_id FROM daily_action_managed_files dam JOIN daily_action_tags dat ON dat.daily_action_id=dam.daily_action_id WHERE dam.managed_file_id=m.id
                 UNION SELECT tt.tag_id FROM todo_managed_files tm JOIN todo_tags tt ON tt.todo_id=tm.todo_id WHERE tm.managed_file_id=m.id
                 UNION SELECT mt.tag_id FROM memo_managed_files mm JOIN memos mo ON mo.id=mm.memo_id AND mo.deleted_at IS NULL JOIN memo_tags mt ON mt.memo_id=mo.id WHERE mm.managed_file_id=m.id
               )), '') AS joinedTags
        FROM managed_files m WHERE m.deleted_at IS NULL
        UNION ALL
        SELECT f.id, 'index' AS sourceType, f.root_id AS rootId, f.relative_path AS relativePath,
               NULL AS uploadId, f.name, f.extension, f.indexed_at AS indexedAt,
               NULL AS createdAt, f.metadata_revision AS metadataRevision,
               coalesce(group_concat(ft.tag_id, char(31)), '') AS joinedTags
        FROM file_index_items f LEFT JOIN file_index_item_tags ft ON ft.file_index_item_id = f.id
        WHERE f.deleted_at IS NULL GROUP BY f.id
        UNION ALL
        SELECT 'journal:' || fl.id, 'journal', fl.root_id, fl.relative_path, NULL,
               CASE WHEN fl.display_name <> '' THEN fl.display_name ELSE fl.relative_path END, '',
               NULL, fl.created_at, NULL, coalesce(group_concat(jt.tag_id, char(31)), '')
        FROM file_links fl JOIN journal_entries j ON j.id = fl.journal_id
        LEFT JOIN journal_tags jt ON jt.journal_id = j.id
        WHERE j.deleted_at IS NULL AND fl.target_type = 'file' GROUP BY fl.id
        UNION ALL
        SELECT 'upload:' || u.id, 'upload', NULL, NULL, u.id, u.original_name, '',
               NULL, u.created_at, NULL, coalesce((SELECT group_concat(tag_id) FROM (
                 SELECT dat.tag_id FROM daily_action_uploads dau JOIN daily_actions da ON da.id = dau.daily_action_id AND da.deleted_at IS NULL JOIN daily_action_tags dat ON dat.daily_action_id = da.id WHERE dau.upload_id = u.id
                 UNION SELECT mt.tag_id FROM memo_uploads mu JOIN memos mo ON mo.id = mu.memo_id AND mo.deleted_at IS NULL JOIN memo_tags mt ON mt.memo_id = mo.id WHERE mu.upload_id = u.id
               )), '')
        FROM managed_uploads u
        WHERE u.deleted_at IS NULL AND (
          EXISTS (SELECT 1 FROM daily_action_uploads dau JOIN daily_actions da ON da.id = dau.daily_action_id WHERE dau.upload_id = u.id AND da.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM memo_uploads mu JOIN memos mo ON mo.id = mu.memo_id WHERE mu.upload_id = u.id AND mo.deleted_at IS NULL))
      ) ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?
    `).all(Math.min(2000, Math.max(1, limit)), Math.max(0, offset));
    return rows.map(({ joinedTags, ...row }) => {
      const name = row.name.split(/[\\/]/).at(-1);
      const extensionSource = name.includes(".") ? name : (row.relativePath || "");
      const extension = row.extension || (extensionSource.includes(".") ? extensionSource.split(".").at(-1).toLowerCase() : "");
      const separator = row.sourceType === "upload" ? "," : String.fromCharCode(31);
      const item = { ...row, name, extension, tagIds: joinedTags ? [...new Set(joinedTags.split(separator).filter(Boolean))].sort() : [] };
      return row.sourceType === "managed" ? { ...item, ...this.fileById(row.id) } : item;
    });
  }

  fileCount() {
    return this.database.prepare("SELECT count(*) AS count FROM managed_files WHERE deleted_at IS NULL").get().count;
  }

  fileById(id) {
    if (id.startsWith("managed-file-")) {
      const row=this.database.prepare("SELECT id,'managed' AS sourceType,root_id AS rootId,relative_path AS relativePath,name,extension,created_at AS createdAt,revision AS metadataRevision FROM managed_files WHERE id=? AND deleted_at IS NULL").get(id);
      if(!row)return null;
      row.actions=this.database.prepare("SELECT a.id,a.action AS title,a.action_date AS itemDate FROM daily_action_managed_files r JOIN daily_actions a ON a.id=r.daily_action_id WHERE r.managed_file_id=? AND a.deleted_at IS NULL ORDER BY a.action_date DESC,a.start_time").all(id);
      row.todos=this.database.prepare("SELECT t.id,t.title,t.due_date AS itemDate FROM todo_managed_files r JOIN todos t ON t.id=r.todo_id WHERE r.managed_file_id=? AND t.deleted_at IS NULL ORDER BY t.due_date").all(id);
      row.memos=this.database.prepare("SELECT m.id,m.title,substr(m.created_at,1,10) AS itemDate FROM memo_managed_files r JOIN memos m ON m.id=r.memo_id WHERE r.managed_file_id=? AND m.deleted_at IS NULL ORDER BY m.created_at DESC").all(id);
      row.tagIds=[...new Set([...this.database.prepare("SELECT dat.tag_id AS tagId FROM daily_action_managed_files r JOIN daily_action_tags dat ON dat.daily_action_id=r.daily_action_id WHERE r.managed_file_id=?").all(id),...this.database.prepare("SELECT tt.tag_id AS tagId FROM todo_managed_files r JOIN todo_tags tt ON tt.todo_id=r.todo_id WHERE r.managed_file_id=?").all(id),...this.database.prepare("SELECT mt.tag_id AS tagId FROM memo_managed_files r JOIN memos m ON m.id=r.memo_id AND m.deleted_at IS NULL JOIN memo_tags mt ON mt.memo_id=m.id WHERE r.managed_file_id=?").all(id)].map(x=>x.tagId))];
      return row;
    }
    if (id.startsWith("journal:")) {
      const linkId = id.slice(8);
      const row = this.database.prepare("SELECT 'journal:' || fl.id AS id, 'journal' AS sourceType, fl.root_id AS rootId, fl.relative_path AS relativePath, CASE WHEN fl.display_name <> '' THEN fl.display_name ELSE fl.relative_path END AS name, fl.created_at AS createdAt FROM file_links fl JOIN journal_entries j ON j.id = fl.journal_id WHERE fl.id = ? AND fl.target_type = 'file' AND j.deleted_at IS NULL").get(linkId);
      if (!row) return null;
      row.name = row.name.split(/[\\/]/).at(-1); const extensionSource = row.name.includes(".") ? row.name : row.relativePath; row.extension = extensionSource.includes(".") ? extensionSource.split(".").at(-1).toLowerCase() : "";
      row.tagIds = this.database.prepare("SELECT jt.tag_id AS tagId FROM file_links fl JOIN journal_tags jt ON jt.journal_id = fl.journal_id WHERE fl.id = ? ORDER BY jt.tag_id").all(linkId).map((tag) => tag.tagId);
      return row;
    }
    if (id.startsWith("upload:")) {
      const uploadId = id.slice(7);
      const row = this.database.prepare("SELECT 'upload:' || u.id AS id, 'upload' AS sourceType, u.id AS uploadId, u.original_name AS name, u.created_at AS createdAt FROM managed_uploads u WHERE u.id = ? AND u.deleted_at IS NULL AND (EXISTS (SELECT 1 FROM daily_action_uploads dau JOIN daily_actions da ON da.id = dau.daily_action_id WHERE dau.upload_id = u.id AND da.deleted_at IS NULL) OR EXISTS (SELECT 1 FROM memo_uploads mu JOIN memos m ON m.id = mu.memo_id WHERE mu.upload_id = u.id AND m.deleted_at IS NULL))").get(uploadId);
      if (!row) return null;
      row.extension = row.name.includes(".") ? row.name.split(".").at(-1).toLowerCase() : "";
      row.tagIds = this.database.prepare("SELECT dat.tag_id AS tagId FROM daily_action_uploads dau JOIN daily_actions da ON da.id = dau.daily_action_id JOIN daily_action_tags dat ON dat.daily_action_id = da.id WHERE dau.upload_id = ? AND da.deleted_at IS NULL UNION SELECT mt.tag_id FROM memo_uploads mu JOIN memos m ON m.id = mu.memo_id JOIN memo_tags mt ON mt.memo_id = m.id WHERE mu.upload_id = ? AND m.deleted_at IS NULL ORDER BY 1").all(uploadId, uploadId).map((tag) => tag.tagId);
      row.memos = this.database.prepare("SELECT m.id, m.title, substr(m.created_at, 1, 10) AS itemDate FROM memo_uploads mu JOIN memos m ON m.id = mu.memo_id WHERE mu.upload_id = ? AND m.deleted_at IS NULL ORDER BY m.created_at DESC").all(uploadId);
      return row;
    }
    const row = this.database.prepare("SELECT id, root_id AS rootId, relative_path AS relativePath, name, extension, modified_at AS modifiedAt, indexed_at AS indexedAt, metadata_revision AS metadataRevision FROM file_index_items WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!row) return null;
    row.sourceType = "index";
    row.tagIds = this.database.prepare("SELECT tag_id AS tagId FROM file_index_item_tags WHERE file_index_item_id = ? ORDER BY tag_id").all(id).map((tag) => tag.tagId);
    return row;
  }

  createManagedFile(rootId, relativePath) {
    const now=new Date().toISOString(),name=relativePath.split("/").at(-1),extension=name.includes(".")?name.split(".").at(-1).toLowerCase():"";
    const existing=this.database.prepare("SELECT id FROM managed_files WHERE root_id=? AND relative_path=? AND deleted_at IS NULL").get(rootId,relativePath);
    if(existing)return this.fileById(existing.id);
    const id=`managed-file-${randomUUID()}`;
    this.database.prepare("INSERT INTO managed_files(id,root_id,relative_path,name,extension,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id,rootId,relativePath,name,extension,now,now);
    return this.fileById(id);
  }

  updateFileTags(id, tagIds, metadataRevision) {
    return transaction(this.database, () => {
      const result = this.database.prepare("UPDATE file_index_items SET metadata_revision = metadata_revision + 1 WHERE id = ? AND metadata_revision = ? AND deleted_at IS NULL").run(id, metadataRevision);
      if (Number(result.changes) !== 1) { const error = new Error("ファイル情報が別の画面で更新されました。再読み込みしてください。"); error.statusCode = 409; throw error; }
      const archivedTags=this.database.prepare("SELECT r.tag_id AS tagId FROM file_index_item_tags r JOIN tags t ON t.id=r.tag_id WHERE r.file_index_item_id=? AND t.archived_at IS NOT NULL").all(id).map(row=>row.tagId);
      this.database.prepare("DELETE FROM file_index_item_tags WHERE file_index_item_id = ?").run(id);
      const addTag = this.database.prepare("INSERT INTO file_index_item_tags(file_index_item_id, tag_id) VALUES (?, ?)");
      for (const tagId of [...new Set([...tagIds,...archivedTags])]) addTag.run(id, tagId);
      return this.fileById(id);
    });
  }

  search(query, limit = 80) {
    const journals = query.trim() ? this.listJournals({ query, limit }) : [];
    const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const activities = query.trim() ? this.database.prepare("SELECT id, started_at AS occurredAt, application_name AS applicationName, window_title AS windowTitle, project_name AS projectName FROM activity_events WHERE deleted_at IS NULL AND (application_name LIKE ? ESCAPE '\\' OR window_title LIKE ? ESCAPE '\\' OR project_name LIKE ? ESCAPE '\\') ORDER BY started_at DESC LIMIT ?").all(like, like, like, limit) : [];
    const files = query.trim() ? this.database.prepare("SELECT id, root_id AS rootId, relative_path AS relativePath, name, extension FROM managed_files WHERE deleted_at IS NULL AND (name LIKE ? ESCAPE '\\' OR relative_path LIKE ? ESCAPE '\\') ORDER BY name COLLATE NOCASE LIMIT ?").all(like, like, limit) : [];
    const library = query.trim() ? this.database.prepare("SELECT id, item_type AS itemType, title, authors_json AS authorsJson, publication_year AS year, reading_status AS status, favorite FROM library_items WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR authors_json LIKE ? ESCAPE '\\' OR publication LIKE ? ESCAPE '\\' OR keywords_json LIKE ? ESCAPE '\\' OR doi LIKE ? ESCAPE '\\' OR bibtex_code LIKE ? ESCAPE '\\' OR takeaway_markdown LIKE ? ESCAPE '\\') ORDER BY favorite DESC, updated_at DESC LIMIT ?").all(like, like, like, like, like, like, like, limit).map((row) => { const item = { ...row, favorite: Boolean(row.favorite), authors: JSON.parse(row.authorsJson) }; delete item.authorsJson; return item; }) : [];
    const memos = query.trim() ? this.listMemos({ query, limit }) : [];
    return { journals, activities, files, library, memos };
  }

  upsertActivityBatch(source, events) {
    const now = new Date().toISOString();
    return transaction(this.database, () => {
      this.database.prepare("INSERT INTO activity_sources(id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at").run(source.id, source.name, now, now);
      const statement = this.database.prepare(`
        INSERT INTO activity_events(id, source_id, external_id, started_at, ended_at, application_name, window_title, root_id, relative_path, project_name, source_revision, source_updated_at, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, external_id) DO UPDATE SET
          started_at = excluded.started_at, ended_at = excluded.ended_at,
          application_name = excluded.application_name, window_title = excluded.window_title,
          root_id = excluded.root_id, relative_path = excluded.relative_path,
          project_name = excluded.project_name, source_revision = excluded.source_revision,
          source_updated_at = excluded.source_updated_at, received_at = excluded.received_at,
          deleted_at = NULL
        WHERE excluded.source_revision >= activity_events.source_revision
      `);
      let accepted = 0;
      for (const event of events) {
        const result = statement.run(event.id || `activity-${randomUUID()}`, source.id, event.externalId, event.startedAt, event.endedAt || null, event.applicationName, event.windowTitle, event.rootId || null, event.relativePath || null, event.projectName, event.sourceRevision, event.sourceUpdatedAt || null, now);
        accepted += Number(result.changes);
      }
      return { accepted, received: events.length };
    });
  }

  upsertFileIndexBatch(source, items) {
    const now = new Date().toISOString();
    return transaction(this.database, () => {
      this.database.prepare("INSERT INTO file_index_sources(id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at").run(source.id, source.name, now, now);
      const statement = this.database.prepare(`
        INSERT INTO file_index_items(id, source_id, external_id, root_id, relative_path, name, extension, size_bytes, modified_at, indexed_at, source_revision, missing)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, external_id) DO UPDATE SET
          root_id = excluded.root_id, relative_path = excluded.relative_path,
          name = excluded.name, extension = excluded.extension, size_bytes = excluded.size_bytes,
          modified_at = excluded.modified_at, indexed_at = excluded.indexed_at,
          source_revision = excluded.source_revision, missing = excluded.missing, deleted_at = NULL
        WHERE excluded.source_revision >= file_index_items.source_revision
      `);
      let accepted = 0;
      for (const item of items) {
        const result = statement.run(item.id || `indexed-file-${randomUUID()}`, source.id, item.externalId, item.rootId, item.relativePath, item.name, item.extension, item.sizeBytes, item.modifiedAt || null, item.indexedAt || now, item.sourceRevision, item.missing ? 1 : 0);
        accepted += Number(result.changes);
      }
      return { accepted, received: items.length };
    });
  }

  integrity() {
    return { integrity: this.database.prepare("PRAGMA integrity_check").all(), foreignKeys: this.database.prepare("PRAGMA foreign_key_check").all() };
  }
}

module.exports = { SqliteRepository, ftsQuery };
