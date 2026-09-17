//! A selected file is a capability for one directory entry, never its folder.
//! Unix operations stay relative to a retained directory handle and refuse
//! symlinks, including after the visible host path is renamed or replaced.
use sha2::{Digest, Sha256};
use std::path::Path;

pub(crate) const MAX_EDIT_FILE_BYTES: usize = 256 * 1024;

pub(crate) fn content_version(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(crate) struct TextFileSnapshot {
    pub content: String,
    pub version: String,
    pub size: u64,
}

pub(crate) struct FileScope {
    pub name: String,
    #[cfg(unix)]
    parent: std::fs::File,
}

fn validate_file_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.encode_utf16().count() > 255
        || name.trim_matches(|character: char| character.is_whitespace() || character == '\u{feff}')
            != name || name.chars().any(|character| {
        character.is_control()
            || matches!(character, '/' | '\\' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
    }) {
        return Err("This file name is not supported for editing. Use a name of up to 255 characters without surrounding whitespace, path separators, or control characters.".to_string());
    }
    Ok(())
}

fn validate_text(bytes: &[u8]) -> Result<&str, String> {
    if bytes.len() > MAX_EDIT_FILE_BYTES {
        return Err("File editing is limited to UTF-8 text files up to 256 KiB.".to_string());
    }
    if bytes
        .iter()
        .any(|byte| *byte < 0x20 && !matches!(byte, b'\t' | b'\n' | b'\r'))
    {
        return Err(
            "Binary files cannot be opened for editing. Choose a UTF-8 text file.".to_string(),
        );
    }
    std::str::from_utf8(bytes)
        .map_err(|_| "This file is not UTF-8 text and cannot be opened for editing.".to_string())
}

impl FileScope {
    pub fn validate_path(&self, relative_path: &str) -> Result<(), String> {
        if relative_path != self.name {
            return Err("This grant allows access only to the selected file.".to_string());
        }
        Ok(())
    }

    pub fn list(&self, relative_path: &str) -> Result<TextFileSnapshot, String> {
        if !relative_path.is_empty() {
            self.validate_path(relative_path)?;
        }
        self.read(&self.name)
    }
}

#[cfg(unix)]
mod unix {
    use super::*;
    use std::ffi::CString;
    use std::fs::{self, File, OpenOptions};
    use std::io::{Read, Write};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    use std::sync::Mutex;

    // Serialize native writes across separately issued grants for the same file.
    // External editors are checked by content hash immediately before commit.
    static FILE_WRITES: Mutex<()> = Mutex::new(());

    fn conflict() -> String {
        "FILE_VERSION_CONFLICT: The file changed outside this edit. Read it again before saving."
            .to_string()
    }

    impl FileScope {
        pub fn open(selected: &Path) -> Result<Self, String> {
            let metadata = fs::symlink_metadata(selected)
                .map_err(|_| "The selected file is unavailable.".to_string())?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err("Choose a regular file, not a folder or symbolic link.".to_string());
            }
            let canonical = fs::canonicalize(selected)
                .map_err(|_| "The selected file is unavailable.".to_string())?;
            let name = canonical
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty())
                .ok_or_else(|| "The selected file must have a valid UTF-8 name.".to_string())?
                .to_string();
            validate_file_name(&name)?;
            let parent = OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(
                    canonical
                        .parent()
                        .ok_or_else(|| "The selected file is unavailable.".to_string())?,
                )
                .map_err(|_| "The selected file's location is unavailable.".to_string())?;
            let scope = Self { name, parent };
            let file = scope.open_reader()?;
            let opened = file
                .metadata()
                .map_err(|_| "The selected file is unavailable.".to_string())?;
            if opened.dev() != metadata.dev() || opened.ino() != metadata.ino() {
                return Err("The selected file changed while opening. Choose it again.".to_string());
            }
            Self::snapshot(file)?;
            Ok(scope)
        }

        fn entry_name(&self) -> CString {
            // A filesystem basename cannot contain NUL; open() validated UTF-8.
            CString::new(self.name.as_bytes()).expect("validated file basename")
        }

        fn open_reader(&self) -> Result<File, String> {
            let name = self.entry_name();
            // SAFETY: parent owns a live directory fd; name is NUL-terminated.
            // O_NOFOLLOW prevents a swapped symlink; O_NONBLOCK avoids hanging
            // on a swapped FIFO before the regular-file check below.
            let fd = unsafe {
                libc::openat(
                    self.parent.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
                )
            };
            if fd < 0 {
                return Err(
                    "The selected file is unavailable or was replaced by a symbolic link."
                        .to_string(),
                );
            }
            // SAFETY: openat returned a new owned descriptor.
            let file = unsafe { File::from_raw_fd(fd) };
            if !file
                .metadata()
                .map_err(|_| "Could not inspect the selected file.".to_string())?
                .is_file()
            {
                return Err("The selected target is no longer a regular file.".to_string());
            }
            Ok(file)
        }

        fn snapshot(file: File) -> Result<TextFileSnapshot, String> {
            let mut bytes = Vec::new();
            file.take(MAX_EDIT_FILE_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not read the selected file.".to_string())?;
            let content = validate_text(&bytes)?.to_string();
            Ok(TextFileSnapshot {
                content,
                version: content_version(&bytes),
                size: bytes.len() as u64,
            })
        }

        pub fn read(&self, relative_path: &str) -> Result<TextFileSnapshot, String> {
            self.validate_path(relative_path)?;
            Self::snapshot(self.open_reader()?)
        }

        pub fn write(
            &self,
            relative_path: &str,
            bytes: &[u8],
            expected_version: Option<&str>,
        ) -> Result<String, String> {
            self.validate_path(relative_path)?;
            validate_text(bytes)?;
            let expected = expected_version
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    "A file version is required. Read the selected file before saving.".to_string()
                })?;
            let _write_lock = FILE_WRITES
                .lock()
                .map_err(|_| "File editing is temporarily unavailable.".to_string())?;
            if self.read(relative_path)?.version != expected {
                return Err(conflict());
            }

            let temporary =
                CString::new(format!(".rift-write-{}.tmp", uuid::Uuid::new_v4())).unwrap();
            // SAFETY: live directory fd and NUL-terminated exclusive temp name.
            let fd = unsafe {
                libc::openat(
                    self.parent.as_raw_fd(),
                    temporary.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o600,
                )
            };
            if fd < 0 {
                return Err("Could not prepare the selected file for saving.".to_string());
            }
            // SAFETY: openat returned a new owned descriptor.
            let mut file = unsafe { File::from_raw_fd(fd) };
            let result =
                (|| {
                    file.write_all(bytes)
                        .and_then(|_| file.sync_all())
                        .map_err(|_| "Could not write the selected file.".to_string())?;
                    let current = self.open_reader()?;
                    let metadata = current.metadata().map_err(|_| {
                        "Could not inspect the selected file's permissions.".to_string()
                    })?;
                    if Self::snapshot(current.try_clone().map_err(|_| {
                        "Could not verify the selected file before saving.".to_string()
                    })?)?
                    .version
                        != expected
                    {
                        return Err(conflict());
                    }
                    let temporary_metadata = file
                        .metadata()
                        .map_err(|_| "Could not inspect temporary file permissions.".to_string())?;
                    if (temporary_metadata.uid(), temporary_metadata.gid())
                        != (metadata.uid(), metadata.gid())
                    {
                        // SAFETY: file is a live owned fd; owner/group come from the target.
                        if unsafe { libc::fchown(file.as_raw_fd(), metadata.uid(), metadata.gid()) }
                            != 0
                        {
                            return Err("Could not preserve the selected file's owner and group."
                                .to_string());
                        }
                    }
                    #[cfg(target_os = "macos")]
                    // SAFETY: both descriptors are live files. Only ACL metadata is
                    // copied, never old content, timestamps or compression attributes.
                    if unsafe {
                        libc::fcopyfile(
                            current.as_raw_fd(),
                            file.as_raw_fd(),
                            std::ptr::null_mut(),
                            libc::COPYFILE_ACL,
                        )
                    } != 0
                    {
                        return Err("Could not preserve the selected file's access permissions."
                            .to_string());
                    }
                    file.set_permissions(metadata.permissions())
                        .and_then(|_| file.sync_all())
                        .map_err(|_| {
                            "Could not preserve the selected file's permissions.".to_string()
                        })?;
                    let target = self.entry_name();
                    // SAFETY: both names are basenames within the retained parent.
                    if unsafe {
                        libc::renameat(
                            self.parent.as_raw_fd(),
                            temporary.as_ptr(),
                            self.parent.as_raw_fd(),
                            target.as_ptr(),
                        )
                    } != 0
                    {
                        return Err("Could not save the selected file.".to_string());
                    }
                    Ok(content_version(bytes))
                })();
            if result.is_err() {
                // SAFETY: removes only our exclusive temporary directory entry.
                unsafe {
                    libc::unlinkat(self.parent.as_raw_fd(), temporary.as_ptr(), 0);
                }
            }
            result
        }
    }
}

#[cfg(not(unix))]
impl FileScope {
    pub fn open(_selected: &Path) -> Result<Self, String> {
        Err("File-scoped editing is not supported on this desktop platform yet.".to_string())
    }
    pub fn read(&self, _relative_path: &str) -> Result<TextFileSnapshot, String> {
        Err("File-scoped editing is not supported on this desktop platform yet.".to_string())
    }
    pub fn write(
        &self,
        _relative_path: &str,
        _bytes: &[u8],
        _expected_version: Option<&str>,
    ) -> Result<String, String> {
        Err("File-scoped editing is not supported on this desktop platform yet.".to_string())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
    use std::path::PathBuf;
    use std::sync::{Arc, Barrier};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("rift-file-grant-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn file(&self, name: &str, content: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, content).unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn unsupported_names_are_rejected_before_a_grant_is_created() {
        for name in [
            "",
            ".",
            "..",
            " leading.txt",
            "trailing.txt ",
            "part/file",
            "part\\file",
            "hidden\u{202e}.txt",
            "hidden\u{2066}.txt",
            "line\n.txt",
            "\u{feff}file",
        ] {
            assert!(
                validate_file_name(name).is_err(),
                "accepted unsupported name {name:?}"
            );
        }
        assert!(validate_file_name(&"x".repeat(256)).is_err());
        assert!(validate_file_name("normal file-ç.txt").is_ok());
        let fixture = Fixture::new();
        assert!(FileScope::open(&fixture.file(" leading.txt", b"text")).is_err());
    }

    #[test]
    fn selected_file_never_grants_parent_sibling_absolute_or_traversal_access() {
        let fixture = Fixture::new();
        let selected = fixture.file("selected.txt", b"selected");
        let sibling = fixture.file("sibling.txt", b"private");
        let scope = FileScope::open(&selected).unwrap();
        let version = scope.read("selected.txt").unwrap().version;
        for path in [
            "sibling.txt",
            "../sibling.txt",
            ".",
            "",
            "./selected.txt",
            "selected.txt/../sibling.txt",
            sibling.to_str().unwrap(),
        ] {
            assert!(scope.read(path).is_err(), "read should reject {path}");
            assert!(
                scope.write(path, b"changed", Some(&version)).is_err(),
                "write should reject {path}"
            );
        }
        assert!(scope.list("").is_ok());
        assert!(scope.list("selected.txt").is_ok());
        assert!(scope.list("..").is_err());
        assert!(scope.list("sibling.txt").is_err());
        assert_eq!(fs::read(sibling).unwrap(), b"private");
    }

    #[test]
    fn text_validation_is_byte_bounded_and_rejects_binary_or_non_utf8() {
        let fixture = Fixture::new();
        for (name, bytes) in [
            ("binary.txt", vec![0, 1, 2]),
            ("invalid.txt", vec![0xff]),
            ("large.txt", vec![b'a'; MAX_EDIT_FILE_BYTES + 1]),
        ] {
            assert!(FileScope::open(&fixture.file(name, &bytes)).is_err());
        }
        let scope =
            FileScope::open(&fixture.file("limit.txt", &vec![b'a'; MAX_EDIT_FILE_BYTES])).unwrap();
        assert_eq!(
            scope.read("limit.txt").unwrap().size,
            MAX_EDIT_FILE_BYTES as u64
        );
        assert!(scope
            .write("limit.txt", &[0], Some("unused"))
            .unwrap_err()
            .contains("Binary"));
        assert!(scope
            .write(
                "limit.txt",
                &vec![b'a'; MAX_EDIT_FILE_BYTES + 1],
                Some("unused")
            )
            .unwrap_err()
            .contains("256 KiB"));
    }

    #[test]
    fn empty_edits_require_a_current_version_and_return_the_new_sha256() {
        let fixture = Fixture::new();
        let path = fixture.file("empty.txt", b"old");
        let scope = FileScope::open(&path).unwrap();
        assert!(scope
            .write("empty.txt", b"", None)
            .unwrap_err()
            .contains("version is required"));
        assert_eq!(fs::read(&path).unwrap(), b"old");
        let original = scope.read("empty.txt").unwrap();
        let version = scope
            .write("empty.txt", b"", Some(&original.version))
            .unwrap();
        assert_eq!(
            version,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(fs::read(path).unwrap(), b"");
        assert_eq!(scope.read("empty.txt").unwrap().version, version);
    }

    #[test]
    fn external_edits_conflict_without_overwriting_them_or_leaving_temp_files() {
        let fixture = Fixture::new();
        let path = fixture.file("edit.txt", b"before");
        let scope = FileScope::open(&path).unwrap();
        let version = scope.read("edit.txt").unwrap().version;
        fs::write(&path, b"external").unwrap();
        assert!(scope
            .write("edit.txt", b"assistant", Some(&version))
            .unwrap_err()
            .starts_with("FILE_VERSION_CONFLICT"));
        assert_eq!(fs::read(&path).unwrap(), b"external");
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }

    #[test]
    fn concurrent_writes_from_two_grants_cannot_both_commit_the_same_version() {
        let fixture = Fixture::new();
        let path = fixture.file("race.txt", b"before");
        let left = FileScope::open(&path).unwrap();
        let right = FileScope::open(&path).unwrap();
        let version = left.read("race.txt").unwrap().version;
        let barrier = Arc::new(Barrier::new(2));
        let threads: Vec<_> = [left, right]
            .into_iter()
            .enumerate()
            .map(|(index, scope)| {
                let barrier = barrier.clone();
                let version = version.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    scope.write(
                        "race.txt",
                        format!("edit {index}").as_bytes(),
                        Some(&version),
                    )
                })
            })
            .collect();
        let results: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(results.iter().filter(|result| matches!(result, Err(error) if error.starts_with("FILE_VERSION_CONFLICT"))).count(), 1);
    }

    #[test]
    fn atomic_replacement_preserves_file_permissions_and_does_not_modify_hardlink_siblings() {
        let fixture = Fixture::new();
        let path = fixture.file("script.sh", b"before");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o751)).unwrap();
        let sibling = fixture.0.join("hardlink.sh");
        fs::hard_link(&path, &sibling).unwrap();
        let scope = FileScope::open(&path).unwrap();
        let original_metadata = fs::metadata(&path).unwrap();
        let version = scope.read("script.sh").unwrap().version;
        scope.write("script.sh", b"after", Some(&version)).unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o751
        );
        let metadata = fs::metadata(&path).unwrap();
        assert_eq!(
            (metadata.uid(), metadata.gid()),
            (original_metadata.uid(), original_metadata.gid())
        );
        assert_eq!(fs::read(sibling).unwrap(), b"before");
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 2);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn atomic_replacement_preserves_macos_access_control_entries() {
        let fixture = Fixture::new();
        let path = fixture.file("acl.txt", b"before");
        assert!(std::process::Command::new("/bin/chmod")
            .args(["+a", "everyone allow read"])
            .arg(&path)
            .status()
            .unwrap()
            .success());
        let acl = || {
            let output = std::process::Command::new("/bin/ls")
                .arg("-le")
                .arg(&path)
                .output()
                .unwrap();
            assert!(output.status.success());
            String::from_utf8(output.stdout)
                .unwrap()
                .lines()
                .skip(1)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        };
        let before = acl();
        assert!(!before.is_empty());
        let scope = FileScope::open(&path).unwrap();
        let version = scope.read("acl.txt").unwrap().version;
        scope.write("acl.txt", b"after", Some(&version)).unwrap();
        assert_eq!(acl(), before);
    }

    #[test]
    fn symlink_selection_and_later_symlink_replacement_never_open_the_target() {
        let fixture = Fixture::new();
        let selected = fixture.file("chosen.txt", b"chosen");
        let sibling = fixture.file("sibling.txt", b"secret");
        let link = fixture.0.join("link.txt");
        symlink(&sibling, &link).unwrap();
        assert!(FileScope::open(&link).is_err());
        let scope = FileScope::open(&selected).unwrap();
        let version = scope.read("chosen.txt").unwrap().version;
        fs::remove_file(&selected).unwrap();
        symlink(&sibling, &selected).unwrap();
        assert!(scope.read("chosen.txt").is_err());
        assert!(scope
            .write("chosen.txt", b"changed", Some(&version))
            .is_err());
        assert_eq!(fs::read(sibling).unwrap(), b"secret");
    }

    #[test]
    fn replacing_the_parent_with_a_symlink_does_not_redirect_the_grant() {
        let fixture = Fixture::new();
        let original = fixture.0.join("original");
        let other = fixture.0.join("other");
        fs::create_dir(&original).unwrap();
        fs::create_dir(&other).unwrap();
        fs::write(original.join("file.txt"), b"chosen").unwrap();
        fs::write(other.join("file.txt"), b"secret").unwrap();
        let scope = FileScope::open(&original.join("file.txt")).unwrap();
        fs::rename(&original, fixture.0.join("moved")).unwrap();
        symlink(&other, &original).unwrap();
        let snapshot = scope.read("file.txt").unwrap();
        assert_eq!(snapshot.content, "chosen");
        scope
            .write("file.txt", b"updated", Some(&snapshot.version))
            .unwrap();
        assert_eq!(fs::read(other.join("file.txt")).unwrap(), b"secret");
    }
}
