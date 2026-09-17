import { posix } from "node:path";
import { z } from "zod";
import { MAX_HUNK_PATCH_BYTES } from "./hunk-patch-policy";
import {
  MAX_WORKSPACE_PATH_LENGTH,
  WorkbenchPathError,
  normalizeWorkspacePath,
} from "./path-policy";
import {
  GIT_REPOSITORY_OUTSIDE_EXIT_CODE,
  GIT_STATUS_FAILED_EXIT_CODE,
  MAX_GIT_STATUS_BYTES,
  MAX_GIT_STATUS_FILES,
} from "./git-status-command";

export const MAX_GIT_DIFF_BYTES = 512 * 1024;
export const MAX_GIT_COMMIT_MESSAGE_BYTES = 4 * 1024;
export const GIT_DIFF_FAILED_EXIT_CODE = 50;
export const GIT_MUTATION_FAILED_EXIT_CODE = 51;
export const GIT_COMMIT_PREFLIGHT_FAILED_EXIT_CODE = 52;
export const GIT_INIT_FAILED_EXIT_CODE = 53;

// Git reports absolute paths, so leave enough room for the fixed workspace
// prefix in addition to the bounded repository-relative path.
const MAX_GIT_ABSOLUTE_PATH_BYTES = 4 * 1024;
const MAX_GIT_DIFF_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_GIT_STAGE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_GIT_INDEX_SCAN_BYTES = 32 * 1024 * 1024;
const MAX_GIT_WORKTREE_HASH_BYTES = 256 * 1024 * 1024;

const encodedDiffLimit = Math.ceil((MAX_GIT_DIFF_BYTES * 4) / 3) + 8;

const diffSectionSchema = z
  .object({
    data: z.string().max(encodedDiffLimit),
    truncated: z.boolean(),
  })
  .strict();

const gitDiffCommandSchema = z
  .object({
    path: z.string().min(1).max(MAX_WORKSPACE_PATH_LENGTH),
    staged: diffSectionSchema,
    unstaged: diffSectionSchema,
  })
  .strict();

const gitMutationFailureCodeSchema = z.enum([
  "content_conversion",
  "index_changed",
  "git_command_failed",
  "identity_required",
  "nothing_staged",
  "repository_busy",
  "unsafe_filter",
  "unsupported_path",
  "file_too_large",
  "operation_in_progress",
  // apply_hunk
  "not_single_hunk",
  "path_mismatch",
  "patch_does_not_apply",
  // init
  "already_a_repository",
]);

const gitCommitPreflightSchema = z
  .object({
    treeOid: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
    parentOid: z
      .string()
      .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
      .nullable(),
    headRef: z.string().min(1).max(MAX_WORKSPACE_PATH_LENGTH).nullable(),
    changedPaths: z
      .array(z.string().min(1).max(MAX_WORKSPACE_PATH_LENGTH))
      .max(MAX_GIT_STATUS_FILES),
    truncated: z.boolean(),
  })
  .strict();

const gitMutationCommandSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      action: z.enum(["stage", "unstage", "commit", "apply_hunk", "init"]),
      oid: z
        .string()
        .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      action: z.enum(["stage", "unstage", "commit", "apply_hunk", "init"]),
      code: gitMutationFailureCodeSchema,
    })
    .strict(),
]);

export type WorkbenchGitDiff = {
  path: string;
  staged: { content: string; truncated: boolean };
  unstaged: { content: string; truncated: boolean };
};

export type WorkbenchGitMutationResult = z.infer<
  typeof gitMutationCommandSchema
>;

export class WorkbenchGitOperationPayloadError extends Error {
  constructor() {
    super("The sandbox returned an invalid Git operation response.");
    this.name = "WorkbenchGitOperationPayloadError";
  }
}

function parseJsonPayload<T>(stdout: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new WorkbenchGitOperationPayloadError();
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new WorkbenchGitOperationPayloadError();
  return parsed.data;
}

function decodeDiffSection(section: z.infer<typeof diffSectionSchema>) {
  const data = Buffer.from(section.data, "base64");
  if (
    data.byteLength > MAX_GIT_DIFF_BYTES ||
    data.toString("base64") !== section.data
  ) {
    throw new WorkbenchGitOperationPayloadError();
  }
  return {
    content: new TextDecoder("utf-8").decode(data),
    truncated: section.truncated,
  };
}

export function parseGitDiffCommand(stdout: string): WorkbenchGitDiff {
  const parsed = parseJsonPayload(stdout, gitDiffCommandSchema);
  return {
    path: parsed.path,
    staged: decodeDiffSection(parsed.staged),
    unstaged: decodeDiffSection(parsed.unstaged),
  };
}

export function parseGitMutationCommand(stdout: string) {
  return parseJsonPayload(stdout, gitMutationCommandSchema);
}

export function parseGitCommitPreflightCommand(stdout: string) {
  return parseJsonPayload(stdout, gitCommitPreflightSchema);
}

/**
 * Validate a user-selected Git path twice: first as a strict repository path,
 * then as a Workbench-visible path beneath the verified repository root.
 */
export function normalizeRepositoryGitPath(
  repositoryPath: string,
  input: string,
) {
  const normalizedRepository = normalizeWorkspacePath(repositoryPath);
  const normalizedFile = normalizeWorkspacePath(input);
  if (!normalizedFile || normalizedFile !== input) {
    throw new WorkbenchPathError(
      "Git paths must be normalized repository-relative paths.",
      "invalid_path",
    );
  }

  const workspacePath = normalizeWorkspacePath(
    normalizedRepository
      ? posix.join(normalizedRepository, normalizedFile)
      : normalizedFile,
  );
  const relativeToRepository = normalizedRepository
    ? posix.relative(normalizedRepository, workspacePath)
    : workspacePath;
  if (relativeToRepository !== normalizedFile) {
    throw new WorkbenchPathError(
      "The Git path leaves the repository root.",
      "path_outside_workspace",
    );
  }
  return normalizedFile;
}

export function encodeGitCommitMessage(message: string) {
  const normalized = message.trim();
  const bytes = Buffer.from(normalized, "utf8");
  if (!normalized || bytes.byteLength > MAX_GIT_COMMIT_MESSAGE_BYTES) {
    throw new WorkbenchPathError(
      `Commit messages must contain 1-${MAX_GIT_COMMIT_MESSAGE_BYTES} UTF-8 bytes.`,
      "invalid_path",
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new WorkbenchPathError(
      "Commit messages cannot contain control characters.",
      "invalid_path",
    );
  }
  return Buffer.from(normalized, "utf8").toString("base64");
}

// The shell command is fully server-owned. User-controlled values arrive only
// as environment data and are passed to /usr/bin/git as Python argv entries or
// stdin. They are never evaluated as shell source.
const ISOLATED_GIT_PYTHON_ENV =
  '/usr/bin/env -i RIFT_ROOT="$RIFT_ROOT" RIFT_REPOSITORY_ROOT="$RIFT_REPOSITORY_ROOT" LANG=C LC_ALL=C TMPDIR=/tmp';

const VERIFIED_DIRECTORY_PYTHON = `
pinned_git_fds=()
class RepositoryOutside(Exception):
    pass
def clean_absolute(value):
    if not value or not os.path.isabs(value) or os.path.normpath(value) != value:
        raise RepositoryOutside()
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise RepositoryOutside()
    return value
def clean_relative(value):
    if not value or len(value.encode("utf-8")) > ${MAX_WORKSPACE_PATH_LENGTH}:
        raise RepositoryOutside()
    if "\\\\" in value or value.startswith("/") or value in (".", ".."):
        raise RepositoryOutside()
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise RepositoryOutside()
    components=value.split("/")
    if any(component in ("", ".", "..") for component in components):
        raise RepositoryOutside()
    if posixpath.normpath(value) != value:
        raise RepositoryOutside()
    return value
def open_directory_beneath(workspace_root,target):
    workspace_root=clean_absolute(workspace_root)
    target=clean_absolute(target)
    try:
        if os.path.commonpath([workspace_root,target]) != workspace_root:
            raise RepositoryOutside()
    except ValueError:
        raise RepositoryOutside()
    flags=os.O_RDONLY|os.O_DIRECTORY
    if hasattr(os,"O_CLOEXEC"):
        flags|=os.O_CLOEXEC
    if hasattr(os,"O_NOFOLLOW"):
        flags|=os.O_NOFOLLOW
    descriptor=os.open(workspace_root,flags)
    try:
        relative=os.path.relpath(target,workspace_root)
        if relative == ".":
            return descriptor
        for component in relative.split(os.sep):
            if component in ("", ".", ".."):
                raise RepositoryOutside()
            next_descriptor=os.open(component,flags,dir_fd=descriptor)
            os.close(descriptor)
            descriptor=next_descriptor
        return descriptor
    except Exception:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise
`;

const VERIFIED_REPOSITORY_PYTHON = `${VERIFIED_DIRECTORY_PYTHON}
def open_child_directory(parent_descriptor,name):
    if not name or "/" in name or name in (".",".."):
        raise RepositoryOutside()
    flags=os.O_RDONLY|os.O_DIRECTORY
    if hasattr(os,"O_CLOEXEC"):
        flags|=os.O_CLOEXEC
    if hasattr(os,"O_NOFOLLOW"):
        flags|=os.O_NOFOLLOW
    return os.open(name,flags,dir_fd=parent_descriptor)
def reject_object_alternates(objects_descriptor):
    try:
        info_descriptor=open_child_directory(objects_descriptor,"info")
    except FileNotFoundError:
        return
    try:
        for alternate_name in ("alternates","http-alternates"):
            try:
                alternate_stat=os.stat(alternate_name,dir_fd=info_descriptor,follow_symlinks=False)
            except FileNotFoundError:
                continue
            if alternate_stat.st_size != 0:
                raise RepositoryOutside()
    finally:
        os.close(info_descriptor)
def validate_tree_nofollow(root_descriptor,max_entries,max_depth):
    entry_count=0
    pending=[(os.dup(root_descriptor),0)]
    try:
        while pending:
            descriptor,depth=pending.pop()
            try:
                with os.scandir(descriptor) as entries:
                    for entry in entries:
                        entry_count+=1
                        if entry_count > max_entries or entry.is_symlink():
                            raise RepositoryOutside()
                        if entry.is_dir(follow_symlinks=False):
                            if depth >= max_depth:
                                raise RepositoryOutside()
                            pending.append((open_child_directory(descriptor,entry.name),depth+1))
                        elif not entry.is_file(follow_symlinks=False):
                            raise RepositoryOutside()
            finally:
                os.close(descriptor)
    except Exception:
        for descriptor,_ in pending:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise
def open_optional_directory(parent_descriptor,name,max_entries,max_depth):
    try:
        descriptor=open_child_directory(parent_descriptor,name)
    except FileNotFoundError:
        return None
    validate_tree_nofollow(descriptor,max_entries,max_depth)
    return descriptor
def validate_regular_file(parent_descriptor,name,required,max_bytes=None,reject_includes=False):
    flags=os.O_RDONLY
    if hasattr(os,"O_CLOEXEC"):
        flags|=os.O_CLOEXEC
    if hasattr(os,"O_NOFOLLOW"):
        flags|=os.O_NOFOLLOW
    try:
        descriptor=os.open(name,flags,dir_fd=parent_descriptor)
    except FileNotFoundError:
        if required:
            raise RepositoryOutside()
        return
    try:
        file_stat=os.fstat(descriptor)
        if not stat.S_ISREG(file_stat.st_mode):
            raise RepositoryOutside()
        if max_bytes is not None:
            if file_stat.st_size > max_bytes:
                raise RepositoryOutside()
            content=bytearray()
            while len(content) <= max_bytes:
                chunk=os.read(descriptor,min(65536,max_bytes+1-len(content)))
                if not chunk:
                    break
                content.extend(chunk)
            if len(content) > max_bytes:
                raise RepositoryOutside()
            if reject_includes and re.search(rb"(?im)^[ \\t]*\\[[ \\t]*include(?:if\\b[^\\]]*)?[ \\t]*\\]",bytes(content)):
                raise RepositoryOutside()
    finally:
        os.close(descriptor)
def validate_admin_variants(git_descriptor,common_descriptor):
    for descriptor in (git_descriptor,common_descriptor):
        with os.scandir(descriptor) as entries:
            for entry in entries:
                if entry.name == "reftable":
                    raise RepositoryOutside()
                if entry.name.startswith("sharedindex."):
                    if entry.is_symlink() or not entry.is_file(follow_symlinks=False):
                        raise RepositoryOutside()
                    validate_regular_file(descriptor,entry.name,True)
def verify_path_parent(repository_root,relative_path):
    relative_path=clean_relative(relative_path)
    flags=os.O_RDONLY|os.O_DIRECTORY
    if hasattr(os,"O_CLOEXEC"):
        flags|=os.O_CLOEXEC
    if hasattr(os,"O_NOFOLLOW"):
        flags|=os.O_NOFOLLOW
    descriptor=os.open(repository_root,flags)
    try:
        for component in relative_path.split("/")[:-1]:
            try:
                next_descriptor=os.open(component,flags,dir_fd=descriptor)
            except FileNotFoundError:
                return relative_path
            os.close(descriptor)
            descriptor=next_descriptor
        return relative_path
    finally:
        os.close(descriptor)
def git_environment(workspace_root,repository_root):
    entries=[
        ("safe.directory",repository_root),
        ("core.fsmonitor","false"),
        ("core.hooksPath","/dev/null"),
        ("core.preloadIndex","false"),
        ("core.untrackedCache","false"),
        ("index.threads","1"),
        ("commit.gpgSign","false"),
        ("tag.gpgSign","false"),
        ("core.attributesFile","/dev/null"),
        ("core.excludesFile","/dev/null"),
        ("core.editor","/bin/false"),
        ("sequence.editor","/bin/false"),
        ("maintenance.auto","0"),
        ("gc.auto","0"),
    ]
    environment={
        "HOME":workspace_root,
        "LANG":"C",
        "LC_ALL":"C",
        "PATH":"/usr/bin:/bin",
        "XDG_CONFIG_HOME":"/nonexistent",
        "GIT_ALLOW_PROTOCOL":"",
        "GIT_ASKPASS":"/bin/false",
        "GIT_ATTR_NOSYSTEM":"1",
        "GIT_CONFIG_GLOBAL":"/dev/null",
        "GIT_CONFIG_NOSYSTEM":"1",
        "GIT_CONFIG_SYSTEM":"/dev/null",
        "GIT_EDITOR":"/bin/false",
        "GIT_LITERAL_PATHSPECS":"1",
        "GIT_MERGE_AUTOEDIT":"no",
        "GIT_NO_LAZY_FETCH":"1",
        "GIT_NO_REPLACE_OBJECTS":"1",
        "GIT_OPTIONAL_LOCKS":"0",
        "GIT_PAGER":"/bin/cat",
        "GIT_PROTOCOL_FROM_USER":"0",
        "GIT_SEQUENCE_EDITOR":"/bin/false",
        "GIT_SSH_COMMAND":"/bin/false",
        "GIT_TERMINAL_PROMPT":"0",
        "PAGER":"/bin/cat",
        "SSH_ASKPASS":"/bin/false",
        "TMPDIR":"/tmp",
        "GIT_CONFIG_COUNT":str(len(entries)),
    }
    for index,(key,value) in enumerate(entries):
        environment["GIT_CONFIG_KEY_"+str(index)]=key
        environment["GIT_CONFIG_VALUE_"+str(index)]=value
    return environment
class GitReadTimeout(RuntimeError):
    pass
def stop_process(process):
    try:
        os.killpg(process.pid,signal.SIGKILL)
    except OSError:
        try:
            process.kill()
        except OSError:
            pass
    process.wait()
def run_quiet(arguments,environment,timeout=5,input_bytes=None):
    process=subprocess.Popen(["/usr/bin/git","--no-pager","--no-optional-locks"]+arguments,stdin=subprocess.PIPE if input_bytes is not None else subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=environment,start_new_session=True,pass_fds=pinned_git_fds)
    try:
        process.communicate(input=input_bytes,timeout=timeout)
    except subprocess.TimeoutExpired:
        stop_process(process)
        return None
    return process.returncode
def capture_git_with_input(arguments,environment,input_bytes,max_bytes,timeout=5):
    process=subprocess.Popen(["/usr/bin/git","--no-pager","--no-optional-locks"]+arguments,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=environment,start_new_session=True,pass_fds=pinned_git_fds)
    try:
        stdout,_=process.communicate(input=input_bytes,timeout=timeout)
    except subprocess.TimeoutExpired:
        stop_process(process)
        raise RuntimeError()
    if process.returncode != 0 or len(stdout) > max_bytes:
        raise RuntimeError()
    return stdout
def capture_program(executable,arguments,environment,max_bytes,timeout=5,allowed=(0,),pass_fds=()):
    inherited_fds=tuple(sorted(set(pinned_git_fds+tuple(pass_fds))))
    process=subprocess.Popen([executable]+arguments,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=environment,start_new_session=True,pass_fds=inherited_fds)
    output=bytearray()
    truncated=False
    deadline=time.monotonic()+timeout
    while True:
        remaining=max_bytes-len(output)
        wait_time=deadline-time.monotonic()
        if wait_time <= 0:
            stop_process(process)
            raise GitReadTimeout()
        readable,_,_=select.select([process.stdout.fileno()],[],[],wait_time)
        if not readable:
            stop_process(process)
            raise GitReadTimeout()
        chunk=os.read(process.stdout.fileno(),max(1,min(65536,remaining+1)))
        if not chunk:
            break
        if len(chunk) > remaining:
            output.extend(chunk[:remaining])
            truncated=True
            stop_process(process)
            break
        output.extend(chunk)
    if not truncated:
        try:
            return_code=process.wait(timeout=max(0.1,deadline-time.monotonic()))
        except subprocess.TimeoutExpired:
            stop_process(process)
            raise GitReadTimeout()
        if return_code not in allowed:
            raise RuntimeError()
    return bytes(output),truncated
def capture_bounded(arguments,environment,max_bytes,timeout=5,allowed=(0,)):
    return capture_program("/usr/bin/git",["--no-pager","--no-optional-locks"]+arguments,environment,max_bytes,timeout,allowed)
def run_git_to_file(arguments,environment,target,timeout=5):
    process=subprocess.Popen(["/usr/bin/git","--no-pager","--no-optional-locks"]+arguments,stdin=subprocess.DEVNULL,stdout=target,stderr=subprocess.DEVNULL,env=environment,start_new_session=True,pass_fds=pinned_git_fds)
    try:
        return_code=process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        stop_process(process)
        raise RuntimeError()
    if return_code != 0:
        raise RuntimeError()
try:
    workspace_root=clean_absolute(os.environ["RIFT_ROOT"])
    repository_root=clean_absolute(os.environ["RIFT_REPOSITORY_ROOT"])
    repository_descriptor=open_directory_beneath(workspace_root,repository_root)
    os.fchdir(repository_descriptor)
except (KeyError,OSError,RepositoryOutside):
    sys.exit(${GIT_REPOSITORY_OUTSIDE_EXIT_CODE})
environment=git_environment(workspace_root,repository_root)
try:
    verified_root,_=capture_bounded(["rev-parse","--show-toplevel"],environment,${MAX_GIT_ABSOLUTE_PATH_BYTES})
    verified_root=clean_absolute(verified_root.rstrip(b"\\n").decode("utf-8"))
    if verified_root != repository_root:
        raise RepositoryOutside()
    git_directory_raw,_=capture_bounded(["rev-parse","--absolute-git-dir"],environment,${MAX_GIT_ABSOLUTE_PATH_BYTES})
    common_directory_raw,_=capture_bounded(["rev-parse","--path-format=absolute","--git-common-dir"],environment,${MAX_GIT_ABSOLUTE_PATH_BYTES})
    git_directory=clean_absolute(git_directory_raw.rstrip(b"\\n").decode("utf-8"))
    common_directory=clean_absolute(common_directory_raw.rstrip(b"\\n").decode("utf-8"))
    git_descriptor=open_directory_beneath(workspace_root,git_directory)
    common_descriptor=open_directory_beneath(workspace_root,common_directory)
    validate_regular_file(git_descriptor,"HEAD",True,${MAX_WORKSPACE_PATH_LENGTH + 128})
    validate_regular_file(git_descriptor,"index",False)
    validate_regular_file(common_descriptor,"packed-refs",False,${MAX_GIT_INDEX_SCAN_BYTES})
    validate_regular_file(common_descriptor,"config",True,1024*1024,True)
    validate_regular_file(git_descriptor,"config.worktree",False,1024*1024,True)
    validate_admin_variants(git_descriptor,common_descriptor)
    refs_descriptor=open_child_directory(common_descriptor,"refs")
    validate_tree_nofollow(refs_descriptor,100000,64)
    logs_descriptor=open_optional_directory(common_descriptor,"logs",100000,64)
    worktree_logs_descriptor=None
    if git_directory != common_directory:
        worktree_logs_descriptor=open_optional_directory(git_descriptor,"logs",100000,64)
    object_directory=os.path.join(common_directory,"objects")
    objects_descriptor=open_child_directory(common_descriptor,"objects")
    reject_object_alternates(objects_descriptor)
    validate_tree_nofollow(objects_descriptor,250000,8)
    pinned_descriptors=[repository_descriptor,git_descriptor,common_descriptor,objects_descriptor,refs_descriptor]
    if logs_descriptor is not None:
        pinned_descriptors.append(logs_descriptor)
    if worktree_logs_descriptor is not None:
        pinned_descriptors.append(worktree_logs_descriptor)
    pinned_git_fds=tuple(pinned_descriptors)
    if sys.platform.startswith("linux"):
        environment["GIT_DIR"]="/dev/fd/"+str(git_descriptor)
        environment["GIT_COMMON_DIR"]="/dev/fd/"+str(common_descriptor)
        environment["GIT_OBJECT_DIRECTORY"]="/dev/fd/"+str(objects_descriptor)
        environment["GIT_WORK_TREE"]="/dev/fd/"+str(repository_descriptor)
    else:
        environment["GIT_DIR"]=git_directory
        environment["GIT_COMMON_DIR"]=common_directory
        environment["GIT_OBJECT_DIRECTORY"]=object_directory
        environment["GIT_WORK_TREE"]=repository_root
except GitReadTimeout:
    sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
except (OSError,UnicodeDecodeError,RuntimeError,RepositoryOutside):
    sys.exit(${GIT_REPOSITORY_OUTSIDE_EXIT_CODE})
`;

// Snapshot the exact index tree before the route applies the workspace path
// policy. The mutation command later requires this same tree, so concurrent
// staging cannot silently add a newly protected path to the commit.
export const GIT_COMMIT_PREFLIGHT_COMMAND = `${ISOLATED_GIT_PYTHON_ENV} /usr/bin/python3 -I -S -c 'import json,os,posixpath,re,select,signal,stat,subprocess,sys,tempfile,time
${VERIFIED_REPOSITORY_PYTHON}
try:
    empty_worktree_holder=tempfile.TemporaryDirectory(dir="/tmp")
    empty_worktree_descriptor=os.open(empty_worktree_holder.name,os.O_RDONLY|os.O_DIRECTORY)
    pinned_git_fds=pinned_git_fds+(empty_worktree_descriptor,)
    environment["GIT_WORK_TREE"]=("/dev/fd/"+str(empty_worktree_descriptor)) if sys.platform.startswith("linux") else empty_worktree_holder.name
    os.fchdir(empty_worktree_descriptor)
    raw_tree,truncated=capture_bounded(["write-tree"],environment,129,5,(0,))
    tree_oid=raw_tree.rstrip(b"\\n").decode("ascii")
    if truncated or raw_tree.count(b"\\n") != 1 or re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})",tree_oid) is None:
        raise RuntimeError()
    head_status=run_quiet(["rev-parse","--verify","--quiet","HEAD"],environment,3)
    if head_status is None or head_status not in (0,1):
        raise RuntimeError()
    head_ref_raw,head_ref_truncated=capture_bounded(["symbolic-ref","--quiet","HEAD"],environment,${MAX_WORKSPACE_PATH_LENGTH + 1},3,(0,1))
    head_ref=head_ref_raw.rstrip(b"\\n").decode("utf-8") if head_ref_raw else None
    if head_ref_truncated or (head_ref is not None and (head_ref_raw.count(b"\\n") != 1 or not head_ref.startswith("refs/heads/") or any(ord(character) < 32 or ord(character) == 127 for character in head_ref))):
        raise RuntimeError()
    if head_status == 0:
        parent_raw,parent_truncated=capture_bounded(["rev-parse","--verify","HEAD"],environment,129,3,(0,))
        parent_oid=parent_raw.rstrip(b"\\n").decode("ascii")
        head_tree_raw,head_tree_truncated=capture_bounded(["rev-parse","--verify","HEAD^{tree}"],environment,129,3,(0,))
        head_tree_oid=head_tree_raw.rstrip(b"\\n").decode("ascii")
        if parent_truncated or head_tree_truncated or parent_raw.count(b"\\n") != 1 or head_tree_raw.count(b"\\n") != 1 or re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})",parent_oid) is None or re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})",head_tree_oid) is None:
            raise RuntimeError()
        path_output,paths_truncated=capture_bounded(["diff-tree","--no-commit-id","--name-only","-z","-r","--no-renames",head_tree_oid,tree_oid],environment,${MAX_GIT_STATUS_BYTES},7,(0,))
    else:
        parent_oid=None
        if head_ref is None:
            raise RuntimeError()
        path_output,paths_truncated=capture_bounded(["ls-tree","-r","--name-only","-z",tree_oid],environment,${MAX_GIT_STATUS_BYTES},7,(0,))
    records=path_output.split(b"\\0")
    if records and records[-1] == b"":
        records=records[:-1]
    elif path_output:
        paths_truncated=True
        records=records[:-1]
    if len(records) > ${MAX_GIT_STATUS_FILES}:
        records=records[:${MAX_GIT_STATUS_FILES}]
        paths_truncated=True
    changed_paths=[]
    for record in records:
        path=record.decode("utf-8")
        changed_paths.append(clean_relative(path))
except (OSError,RuntimeError,UnicodeDecodeError,RepositoryOutside):
    sys.exit(${GIT_COMMIT_PREFLIGHT_FAILED_EXIT_CODE})
print(json.dumps({"treeOid":tree_oid,"parentOid":parent_oid,"headRef":head_ref,"changedPaths":changed_paths,"truncated":paths_truncated},separators=(",",":")))'`;

// Filter-free status for Workbench. It compares HEAD/index object IDs and
// hashes raw no-follow worktree files in Python, so repository conversion
// drivers never receive execution control.
export const FILTER_FREE_GIT_STATUS_COMMAND = `${ISOLATED_GIT_PYTHON_ENV} /usr/bin/python3 -I -S -c 'import hashlib,json,os,posixpath,re,select,signal,stat,subprocess,sys,time
${VERIFIED_REPOSITORY_PYTHON}
scan_bytes=0
scan_truncated=False
scan_deadline=None
def valid_oid(value):
    return re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})",value) is not None
def complete_records(raw,truncated):
    records=raw.split(b"\\0")
    if records and records[-1] == b"":
        records=records[:-1]
    elif raw:
        records=records[:-1]
        truncated=True
    return records,truncated
def parse_index(raw,truncated):
    records,truncated=complete_records(raw,truncated)
    entries={}
    for record in records:
        metadata,raw_path=record.split(b"\\t",1)
        mode,oid,stage_value=metadata.decode("ascii").split(" ")
        path=clean_relative(raw_path.decode("utf-8"))
        stage=int(stage_value)
        if mode not in ("100644","100755","120000","160000") or not valid_oid(oid) or stage not in (0,1,2,3):
            raise RuntimeError()
        path_entries=entries.setdefault(path,{})
        if stage in path_entries:
            raise RuntimeError()
        path_entries[stage]={"mode":mode,"oid":oid}
    return entries,truncated
def parse_head(raw,truncated):
    records,truncated=complete_records(raw,truncated)
    entries={}
    for record in records:
        metadata,raw_path=record.split(b"\\t",1)
        mode,object_type,oid=metadata.decode("ascii").split(" ")
        path=clean_relative(raw_path.decode("utf-8"))
        if path in entries or mode not in ("100644","100755","120000","160000") or object_type not in ("blob","commit") or not valid_oid(oid):
            raise RuntimeError()
        entries[path]={"mode":mode,"oid":oid}
    return entries,truncated
def parse_paths(raw,truncated):
    records,truncated=complete_records(raw,truncated)
    paths=[]
    seen=set()
    for record in records:
        path=clean_relative(record.decode("utf-8"))
        if path in seen:
            raise RuntimeError()
        seen.add(path)
        paths.append(path)
    return paths,truncated
def parse_index_flags(raw,truncated):
    records,truncated=complete_records(raw,truncated)
    flags={}
    for record in records:
        if len(record) < 3 or record[1:2] != b" ":
            raise RuntimeError()
        tag=chr(record[0])
        path=clean_relative(record[2:].decode("utf-8"))
        path_flags={"skipWorktree":tag == "S","assumeUnchanged":tag.islower()}
        existing=flags.get(path)
        if existing is not None and existing != path_flags:
            raise RuntimeError()
        flags[path]=path_flags
    return flags,truncated
def parse_index_debug(raw,truncated):
    if truncated:
        return {},True
    debug_pattern=re.compile(rb"  ctime: [0-9]+:[0-9]+\\n  mtime: [0-9]+:[0-9]+\\n  dev: [0-9]+\\tino: [0-9]+\\n  uid: [0-9]+\\tgid: [0-9]+\\n  size: [0-9]+\\tflags: ([0-9a-fA-F]+)\\n")
    cursor=0
    flags={}
    while cursor < len(raw):
        separator=raw.find(b"\\0",cursor)
        if separator < 0:
            raise RuntimeError()
        path=clean_relative(raw[cursor:separator].decode("utf-8"))
        match=debug_pattern.match(raw,separator+1)
        if match is None:
            raise RuntimeError()
        flags[path]=flags.get(path,0)|int(match.group(1),16)
        cursor=match.end()
    return flags,False
def open_parent(path):
    components=clean_relative(path).split("/")
    flags=os.O_RDONLY|os.O_DIRECTORY
    if hasattr(os,"O_CLOEXEC"):
        flags|=os.O_CLOEXEC
    if hasattr(os,"O_NOFOLLOW"):
        flags|=os.O_NOFOLLOW
    descriptor=os.dup(repository_descriptor)
    try:
        for component in components[:-1]:
            next_descriptor=os.open(component,flags,dir_fd=descriptor)
            os.close(descriptor)
            descriptor=next_descriptor
        return descriptor,components[-1]
    except Exception:
        os.close(descriptor)
        raise
def blob_oid_from_bytes(value,object_format):
    digest=hashlib.sha1() if object_format == "sha1" else hashlib.sha256()
    digest.update(b"blob "+str(len(value)).encode("ascii")+b"\\0")
    digest.update(value)
    return digest.hexdigest()
def read_worktree(path,index_entry,object_format,core_filemode):
    global scan_bytes,scan_truncated
    index_mode=index_entry["mode"]
    try:
        parent,name=open_parent(path)
    except FileNotFoundError:
        return {"exists":False,"mode":None,"oid":None,"uncertain":False}
    try:
        try:
            path_stat=os.stat(name,dir_fd=parent,follow_symlinks=False)
        except FileNotFoundError:
            return {"exists":False,"mode":None,"oid":None,"uncertain":False}
        if stat.S_ISDIR(path_stat.st_mode) and index_mode == "160000":
            return {"exists":True,"mode":"160000","oid":index_entry["oid"],"uncertain":False}
        if stat.S_ISREG(path_stat.st_mode):
            flags=os.O_RDONLY
            if hasattr(os,"O_CLOEXEC"):
                flags|=os.O_CLOEXEC
            if hasattr(os,"O_NOFOLLOW"):
                flags|=os.O_NOFOLLOW
            descriptor=os.open(name,flags,dir_fd=parent)
            try:
                opened_stat=os.fstat(descriptor)
                if not stat.S_ISREG(opened_stat.st_mode):
                    raise RuntimeError()
                mode=index_mode if not core_filemode and index_mode in ("100644","100755") else ("100755" if opened_stat.st_mode & 0o111 else "100644")
                if scan_bytes+opened_stat.st_size > ${MAX_GIT_WORKTREE_HASH_BYTES} or scan_deadline is None or time.monotonic() > scan_deadline:
                    scan_truncated=True
                    return {"exists":True,"mode":mode,"oid":None,"uncertain":True}
                digest=hashlib.sha1() if object_format == "sha1" else hashlib.sha256()
                digest.update(b"blob "+str(opened_stat.st_size).encode("ascii")+b"\\0")
                bytes_read=0
                while True:
                    chunk=os.read(descriptor,65536)
                    if not chunk:
                        break
                    digest.update(chunk)
                    bytes_read+=len(chunk)
                    if time.monotonic() > scan_deadline:
                        scan_truncated=True
                        return {"exists":True,"mode":mode,"oid":None,"uncertain":True}
                final_stat=os.fstat(descriptor)
                scan_bytes+=bytes_read
                if bytes_read != opened_stat.st_size or final_stat.st_size != opened_stat.st_size or final_stat.st_mtime_ns != opened_stat.st_mtime_ns or final_stat.st_ino != opened_stat.st_ino:
                    scan_truncated=True
                    return {"exists":True,"mode":mode,"oid":None,"uncertain":True}
                return {"exists":True,"mode":mode,"oid":digest.hexdigest(),"uncertain":False}
            finally:
                os.close(descriptor)
        if stat.S_ISLNK(path_stat.st_mode):
            if scan_deadline is None or time.monotonic() > scan_deadline:
                scan_truncated=True
                return {"exists":True,"mode":"120000","oid":None,"uncertain":True}
            target=os.fsencode(os.readlink(name,dir_fd=parent))
            scan_bytes+=len(target)
            if scan_bytes > ${MAX_GIT_WORKTREE_HASH_BYTES}:
                scan_truncated=True
                return {"exists":True,"mode":"120000","oid":None,"uncertain":True}
            return {"exists":True,"mode":"120000","oid":blob_oid_from_bytes(target,object_format),"uncertain":False}
        return {"exists":True,"mode":None,"oid":None,"uncertain":False}
    finally:
        os.close(parent)
def change_code(left,right):
    if left is None and right is not None:
        return "A"
    if left is not None and right is None:
        return "D"
    if left is None or right is None:
        return " "
    if left["mode"] != right["mode"]:
        regular_modes={left["mode"],right["mode"]} <= {"100644","100755"}
        return "M" if regular_modes else "T"
    if left.get("oid") != right.get("oid"):
        return "M"
    return " "
def status_name(index_code,working_code,conflict):
    if conflict:
        return "conflict"
    codes={index_code,working_code}
    if "D" in codes:
        return "deleted"
    if "A" in codes:
        return "added"
    if "M" in codes:
        return "modified"
    if "T" in codes:
        return "typechange"
    if "?" in codes:
        return "untracked"
    raise RuntimeError()
try:
    object_format_raw,object_format_truncated=capture_bounded(["rev-parse","--show-object-format"],environment,16,3,(0,))
    object_format=object_format_raw.rstrip(b"\\n").decode("ascii")
    if object_format_truncated or object_format not in ("sha1","sha256"):
        raise RuntimeError()
    filemode_raw,filemode_truncated=capture_bounded(["config","--bool","--get","core.filemode"],environment,16,3,(0,1))
    if filemode_truncated:
        raise RuntimeError()
    core_filemode=filemode_raw.rstrip(b"\\n") != b"false"
    index_raw,index_truncated=capture_bounded(["ls-files","--stage","-z"],environment,${MAX_GIT_INDEX_SCAN_BYTES},7,(0,))
    index_entries,index_truncated=parse_index(index_raw,index_truncated)
    index_flags_raw,index_flags_truncated=capture_bounded(["ls-files","-v","-z"],environment,${MAX_GIT_INDEX_SCAN_BYTES},7,(0,))
    index_flags,index_flags_truncated=parse_index_flags(index_flags_raw,index_flags_truncated)
    index_debug_raw,index_debug_truncated=capture_bounded(["ls-files","--debug","-z"],environment,${MAX_GIT_INDEX_SCAN_BYTES},7,(0,))
    index_debug_flags,index_debug_truncated=parse_index_debug(index_debug_raw,index_debug_truncated)
    head_status=run_quiet(["rev-parse","--verify","--quiet","HEAD"],environment,3)
    if head_status is None or head_status not in (0,1):
        raise RuntimeError()
    if head_status == 0:
        head_raw,head_truncated=capture_bounded(["ls-tree","-r","-z","HEAD"],environment,${MAX_GIT_INDEX_SCAN_BYTES},7,(0,))
        head_entries,head_truncated=parse_head(head_raw,head_truncated)
    else:
        head_entries={}
        head_truncated=False
    untracked_raw,untracked_truncated=capture_bounded(["ls-files","--others","--exclude-standard","-z"],environment,${MAX_GIT_INDEX_SCAN_BYTES},7,(0,))
    untracked_paths,untracked_truncated=parse_paths(untracked_raw,untracked_truncated)
    branch_raw,branch_truncated=capture_bounded(["symbolic-ref","--quiet","HEAD"],environment,${MAX_WORKSPACE_PATH_LENGTH + 12},3,(0,1))
    current_head_ref=branch_raw.rstrip(b"\\n").decode("utf-8") if branch_raw else None
    if branch_truncated or (current_head_ref is not None and (branch_raw.count(b"\\n") != 1 or not current_head_ref.startswith("refs/heads/") or any(ord(character) < 32 or ord(character) == 127 for character in current_head_ref))):
        raise RuntimeError()
    current_branch=current_head_ref[len("refs/heads/"):] if current_head_ref is not None else None
    upstream=None
    ahead=0
    behind=0
    if current_head_ref is not None:
        upstream_raw,upstream_truncated=capture_bounded(["for-each-ref","--count=1","--format=%(upstream)",current_head_ref],environment,${MAX_WORKSPACE_PATH_LENGTH + 12},3,(0,))
        upstream_ref=upstream_raw.rstrip(b"\\n").decode("utf-8") if upstream_raw.rstrip(b"\\n") else None
        if upstream_truncated or upstream_raw.count(b"\\n") > 1 or (upstream_raw and upstream_raw.count(b"\\n") != 1) or (upstream_ref is not None and (not upstream_ref.startswith("refs/") or any(ord(character) < 32 or ord(character) == 127 for character in upstream_ref))):
            raise RuntimeError()
        if upstream_ref is not None:
            divergence_raw,divergence_truncated=capture_bounded(["rev-list","--left-right","--count","HEAD..."+upstream_ref],environment,64,5,(0,))
            if divergence_truncated or divergence_raw.count(b"\\n") != 1:
                raise RuntimeError()
            ahead_text,behind_text=divergence_raw.rstrip(b"\\n").decode("ascii").split()
            ahead=int(ahead_text)
            behind=int(behind_text)
            if ahead < 0 or behind < 0:
                raise RuntimeError()
            upstream=upstream_ref[len("refs/remotes/"):] if upstream_ref.startswith("refs/remotes/") else upstream_ref
    files=[]
    all_paths=sorted(set(head_entries)|set(index_entries)|set(untracked_paths))
    truncated=index_truncated or index_flags_truncated or index_debug_truncated or head_truncated or untracked_truncated
    untracked_set=set(untracked_paths)
    scan_deadline=time.monotonic()+7
    for path in all_paths:
        stages=index_entries.get(path,{})
        conflict=any(stage != 0 for stage in stages)
        index_entry=stages.get(0)
        head_entry=head_entries.get(path)
        if conflict:
            index_code="U"
            working_code="U"
        else:
            intent_to_add=index_entry is not None and bool(index_debug_flags.get(path,0)&0x20000000)
            index_code=" " if intent_to_add else change_code(head_entry,index_entry)
            if index_entry is not None:
                path_flags=index_flags.get(path,{})
                if index_flags_truncated or path_flags.get("skipWorktree") or path_flags.get("assumeUnchanged"):
                    working_code=" "
                else:
                    worktree_entry=read_worktree(path,index_entry,object_format,core_filemode)
                    if not worktree_entry["exists"]:
                        working_code=" " if intent_to_add else "D"
                    elif worktree_entry["uncertain"]:
                        working_code="A" if intent_to_add else "M"
                    else:
                        working_code=change_code(None if intent_to_add else index_entry,worktree_entry)
            else:
                working_code="?" if path in untracked_set else " "
        if index_code == " " and working_code == " ":
            continue
        files.append({"name":path,"status":status_name(index_code,working_code,conflict),"indexStatus":index_code,"workingTreeStatus":working_code,"staged":index_code not in (" ","?")})
        if len(files) > ${MAX_GIT_STATUS_FILES}:
            files=files[:${MAX_GIT_STATUS_FILES}]
            truncated=True
            break
    truncated=truncated or scan_truncated
except (OSError,RuntimeError,UnicodeDecodeError,UnicodeEncodeError,ValueError,RepositoryOutside):
    sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
payload={"ahead":ahead,"behind":behind,"detached":current_branch is None and head_status == 0,"fileStatus":files,"truncated":truncated}
if current_branch is not None:
    payload["currentBranch"]=current_branch
if upstream is not None:
    payload["upstream"]=upstream
print(json.dumps(payload,separators=(",",":")))'`;

// Do not use `git diff` for worktree content here. Git's worktree diff path
// runs convert_to_git(), which can execute repository-defined clean/process
// filters. This command reads raw blobs and no-follow worktree descriptors,
// then invokes only the fixed system `diff` binary.
export const BOUNDED_GIT_DIFF_COMMAND = `${ISOLATED_GIT_PYTHON_ENV} RIFT_GIT_FILE="$RIFT_GIT_FILE" RIFT_GIT_RENAMED_FROM="$RIFT_GIT_RENAMED_FROM" RIFT_GIT_INCLUDE_RENAME_SOURCE="$RIFT_GIT_INCLUDE_RENAME_SOURCE" RIFT_GIT_MAX_DIFF_BYTES="$RIFT_GIT_MAX_DIFF_BYTES" /usr/bin/python3 -I -S -c 'import base64,json,os,posixpath,re,select,signal,stat,subprocess,sys,tempfile,time
${VERIFIED_REPOSITORY_PYTHON}
def valid_oid(value):
    return re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})",value) is not None
def parse_tree_entry(path):
    if not head_exists:
        return None
    raw,truncated=capture_bounded(["ls-tree","-z","HEAD","--",path],environment,${MAX_WORKSPACE_PATH_LENGTH + 256},3,(0,))
    if truncated or not raw:
        return None if not raw else (_ for _ in ()).throw(RuntimeError())
    if not raw.endswith(b"\\0") or raw.count(b"\\0") != 1:
        raise RuntimeError()
    metadata,record_path=raw[:-1].split(b"\\t",1)
    mode,object_type,oid=metadata.decode("ascii").split(" ")
    decoded_path=record_path.decode("utf-8")
    if decoded_path != path or mode not in ("100644","100755","120000","160000") or object_type not in ("blob","commit") or not valid_oid(oid):
        raise RuntimeError()
    return {"mode":mode,"oid":oid}
def parse_index_entry(path):
    raw,truncated=capture_bounded(["ls-files","--stage","-z","--",path],environment,${MAX_WORKSPACE_PATH_LENGTH * 4 + 1024},3,(0,))
    if truncated:
        raise RuntimeError()
    entries={}
    for record in raw.split(b"\\0"):
        if not record:
            continue
        metadata,record_path=record.split(b"\\t",1)
        mode,oid,stage_value=metadata.decode("ascii").split(" ")
        decoded_path=record_path.decode("utf-8")
        stage=int(stage_value)
        if decoded_path != path or mode not in ("100644","100755","120000","160000") or not valid_oid(oid) or stage not in (0,1,2,3):
            raise RuntimeError()
        entries[stage]={"mode":mode,"oid":oid}
    for stage in (0,2,3,1):
        if stage in entries:
            return entries[stage]
    return None
def empty_entry():
    holder=tempfile.TemporaryFile()
    return {"exists":False,"mode":None,"fd":holder.fileno(),"holder":holder,"omitted":False}
def materialize_git_entry(entry):
    if entry is None:
        return empty_entry()
    if entry["mode"] == "160000":
        return {"exists":True,"mode":entry["mode"],"oid":entry["oid"],"fd":None,"holder":None,"omitted":True}
    raw_size,truncated=capture_bounded(["cat-file","-s",entry["oid"]],environment,64,3,(0,))
    try:
        size=int(raw_size.rstrip(b"\\n"))
    except ValueError:
        raise RuntimeError()
    if truncated or size < 0:
        raise RuntimeError()
    if size > ${MAX_GIT_DIFF_INPUT_BYTES}:
        return {"exists":True,"mode":entry["mode"],"oid":entry["oid"],"fd":None,"holder":None,"omitted":True}
    holder=tempfile.TemporaryFile()
    run_git_to_file(["cat-file","blob",entry["oid"]],environment,holder,5)
    if os.fstat(holder.fileno()).st_size != size:
        raise RuntimeError()
    holder.seek(0)
    return {"exists":True,"mode":entry["mode"],"oid":entry["oid"],"fd":holder.fileno(),"holder":holder,"omitted":False}
def open_parent(path):
    components=clean_relative(path).split("/")
    flags=os.O_RDONLY|os.O_DIRECTORY
    if hasattr(os,"O_CLOEXEC"):
        flags|=os.O_CLOEXEC
    if hasattr(os,"O_NOFOLLOW"):
        flags|=os.O_NOFOLLOW
    descriptor=os.dup(repository_descriptor)
    try:
        for component in components[:-1]:
            next_descriptor=os.open(component,flags,dir_fd=descriptor)
            os.close(descriptor)
            descriptor=next_descriptor
        return descriptor,components[-1]
    except Exception:
        os.close(descriptor)
        raise
def open_worktree_entry(path,fallback_mode):
    try:
        parent,name=open_parent(path)
    except FileNotFoundError:
        return empty_entry()
    try:
        try:
            path_stat=os.stat(name,dir_fd=parent,follow_symlinks=False)
        except FileNotFoundError:
            return empty_entry()
        if stat.S_ISREG(path_stat.st_mode):
            flags=os.O_RDONLY
            if hasattr(os,"O_CLOEXEC"):
                flags|=os.O_CLOEXEC
            if hasattr(os,"O_NOFOLLOW"):
                flags|=os.O_NOFOLLOW
            descriptor=os.open(name,flags,dir_fd=parent)
            opened_stat=os.fstat(descriptor)
            if not stat.S_ISREG(opened_stat.st_mode):
                os.close(descriptor)
                raise RuntimeError()
            if not core_filemode and fallback_mode in ("100644","100755"):
                mode=fallback_mode
            else:
                mode="100755" if opened_stat.st_mode & 0o111 else "100644"
            return {"exists":True,"mode":mode,"fd":descriptor,"holder":None,"omitted":opened_stat.st_size > ${MAX_GIT_DIFF_INPUT_BYTES}}
        if stat.S_ISLNK(path_stat.st_mode):
            target=os.fsencode(os.readlink(name,dir_fd=parent))
            if len(target) > ${MAX_GIT_DIFF_INPUT_BYTES}:
                return {"exists":True,"mode":"120000","fd":None,"holder":None,"omitted":True}
            holder=tempfile.TemporaryFile()
            holder.write(target)
            holder.seek(0)
            return {"exists":True,"mode":"120000","fd":holder.fileno(),"holder":holder,"omitted":False}
        return {"exists":True,"mode":fallback_mode,"fd":None,"holder":None,"omitted":True}
    finally:
        os.close(parent)
def mode_lines(left,right):
    if not left["exists"] and right["exists"] and right["mode"]:
        return "new file mode "+right["mode"]+"\\n"
    if left["exists"] and not right["exists"] and left["mode"]:
        return "deleted file mode "+left["mode"]+"\\n"
    if left["mode"] != right["mode"]:
        return "old mode "+str(left["mode"])+"\\nnew mode "+str(right["mode"])+"\\n"
    return ""
def render_pair(path,left,right,limit):
    if limit <= 0:
        return b"",True
    if left.get("oid") is not None and right.get("oid") is not None and left["oid"] == right["oid"] and left["mode"] == right["mode"]:
        return b"",False
    if not left["exists"] and not right["exists"]:
        return b"",False
    header=("diff --git a/"+path+" b/"+path+"\\n"+mode_lines(left,right)).encode("utf-8")
    if left["omitted"] or right["omitted"]:
        piece=header+b"Binary, submodule, or oversized file change omitted.\\n"
        return piece[:limit],True
    if len(header) >= limit:
        return header[:limit],True
    old_label=("a/"+path) if left["exists"] else "/dev/null"
    new_label=("b/"+path) if right["exists"] else "/dev/null"
    diff_output,diff_truncated=capture_program("/usr/bin/diff",["-U","3","-L",old_label,"-L",new_label,"/dev/fd/"+str(left["fd"]),"/dev/fd/"+str(right["fd"])],environment,limit-len(header),5,(0,1),(left["fd"],right["fd"]))
    if not diff_output:
        return (header,False) if mode_lines(left,right) else (b"",False)
    return header+diff_output,diff_truncated
def render_section(pairs):
    output=bytearray()
    truncated=False
    for path,left,right in pairs:
        piece,piece_truncated=render_pair(path,left,right,max_diff_bytes-len(output))
        output.extend(piece)
        truncated=truncated or piece_truncated
        if len(output) >= max_diff_bytes:
            truncated=True
            break
    return bytes(output),truncated
try:
    selected_path=verify_path_parent(repository_root,os.environ["RIFT_GIT_FILE"])
    renamed_from_value=os.environ.get("RIFT_GIT_RENAMED_FROM","")
    include_rename_source=os.environ.get("RIFT_GIT_INCLUDE_RENAME_SOURCE","") == "1"
    renamed_from=verify_path_parent(repository_root,renamed_from_value) if include_rename_source and renamed_from_value else None
    if include_rename_source != (renamed_from is not None):
        raise RuntimeError()
    max_diff_bytes=int(os.environ["RIFT_GIT_MAX_DIFF_BYTES"])
    if max_diff_bytes < 1 or max_diff_bytes > ${MAX_GIT_DIFF_BYTES}:
        raise RuntimeError()
    head_status=run_quiet(["rev-parse","--verify","--quiet","HEAD"],environment,3)
    if head_status is None or head_status not in (0,1):
        raise RuntimeError()
    head_exists=head_status == 0
    filemode_raw,filemode_truncated=capture_bounded(["config","--bool","--get","core.filemode"],environment,16,3,(0,1))
    if filemode_truncated:
        raise RuntimeError()
    core_filemode=filemode_raw.rstrip(b"\\n") != b"false"
    paths=([renamed_from] if renamed_from is not None and renamed_from != selected_path else [])+[selected_path]
    staged_pairs=[]
    unstaged_pairs=[]
    for path in paths:
        head_entry=parse_tree_entry(path)
        index_entry=parse_index_entry(path)
        staged_pairs.append((path,materialize_git_entry(head_entry),materialize_git_entry(index_entry)))
        unstaged_pairs.append((path,materialize_git_entry(index_entry),open_worktree_entry(path,index_entry["mode"] if index_entry else None)))
    staged,staged_truncated=render_section(staged_pairs)
    unstaged,unstaged_truncated=render_section(unstaged_pairs)
except (KeyError,OSError,ValueError,RuntimeError,UnicodeDecodeError,UnicodeEncodeError,RepositoryOutside):
    sys.exit(${GIT_DIFF_FAILED_EXIT_CODE})
print(json.dumps({"path":selected_path,"staged":{"data":base64.b64encode(staged).decode("ascii"),"truncated":staged_truncated},"unstaged":{"data":base64.b64encode(unstaged).decode("ascii"),"truncated":unstaged_truncated}},separators=(",",":")))'`;

/**
 * Creates a repository at a verified workspace directory.
 *
 * Every other Git command begins by discovering an existing repository, so
 * none of them can run here -- the absence of one is the condition. This does
 * its own containment check with the same primitives: the target is opened
 * descriptor by descriptor beneath the workspace root, so a symlinked path
 * cannot redirect `git init` outside the sandbox.
 *
 * Refuses to run where a repository already exists, so it can never reinitialise
 * over someone's history.
 */
export const GIT_INIT_COMMAND = `${ISOLATED_GIT_PYTHON_ENV} RIFT_GIT_INIT_TARGET="$RIFT_GIT_INIT_TARGET" /usr/bin/python3 -I -S -c 'import json,os,posixpath,signal,subprocess,sys
${VERIFIED_DIRECTORY_PYTHON}
def result(ok,code=None):
    payload={"ok":ok,"action":"init"}
    if code is not None:
        payload["code"]=code
    print(json.dumps(payload,separators=(",",":")))
    sys.exit(0)
try:
    workspace_root=clean_absolute(os.environ["RIFT_ROOT"])
    target=clean_absolute(os.environ["RIFT_GIT_INIT_TARGET"])
    descriptor=open_directory_beneath(workspace_root,target)
    os.fchdir(descriptor)
except (KeyError,OSError,RepositoryOutside):
    sys.exit(${GIT_INIT_FAILED_EXIT_CODE})
try:
    # Reinitialising over an existing repository would silently rewrite config
    # for a repository the user did not mean to touch.
    try:
        os.stat(".git",dir_fd=descriptor,follow_symlinks=False)
        result(False,"already_a_repository")
    except FileNotFoundError:
        pass
    except OSError:
        sys.exit(${GIT_INIT_FAILED_EXIT_CODE})
    try:
        completed=subprocess.run(["/usr/bin/git","init","--quiet","--template="],env={"PATH":"/usr/bin:/bin","LANG":"C","LC_ALL":"C","GIT_CONFIG_NOSYSTEM":"1","GIT_CONFIG_GLOBAL":"/dev/null","HOME":"/tmp"},stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
    except (OSError,subprocess.SubprocessError):
        result(False,"git_command_failed")
    if completed.returncode != 0:
        result(False,"git_command_failed")
    result(True)
finally:
    try:
        os.close(descriptor)
    except OSError:
        pass
'`;

export const GIT_MUTATION_COMMAND = `${ISOLATED_GIT_PYTHON_ENV} RIFT_GIT_ACTION="$RIFT_GIT_ACTION" RIFT_GIT_FILE="$RIFT_GIT_FILE" RIFT_GIT_PATCH_B64="$RIFT_GIT_PATCH_B64" RIFT_GIT_HUNK_MODE="$RIFT_GIT_HUNK_MODE" RIFT_GIT_RENAMED_FROM="$RIFT_GIT_RENAMED_FROM" RIFT_GIT_INCLUDE_RENAME_SOURCE="$RIFT_GIT_INCLUDE_RENAME_SOURCE" RIFT_GIT_COMMIT_MESSAGE_B64="$RIFT_GIT_COMMIT_MESSAGE_B64" RIFT_GIT_EXPECTED_TREE="$RIFT_GIT_EXPECTED_TREE" RIFT_GIT_EXPECTED_PARENT="$RIFT_GIT_EXPECTED_PARENT" RIFT_GIT_EXPECTED_HEAD_REF="$RIFT_GIT_EXPECTED_HEAD_REF" /usr/bin/python3 -I -S -c 'import base64,binascii,json,os,posixpath,re,select,signal,stat,subprocess,sys,tempfile,time
${VERIFIED_REPOSITORY_PYTHON}
def result(ok,action,code=None,oid=None):
    payload={"ok":ok,"action":action}
    if code is not None:
        payload["code"]=code
    if oid is not None:
        payload["oid"]=oid
    print(json.dumps(payload,separators=(",",":")))
    sys.exit(0)
try:
    action=os.environ["RIFT_GIT_ACTION"]
    if action not in ("stage","unstage","commit","apply_hunk"):
        raise RuntimeError()
except (KeyError,RuntimeError):
    sys.exit(${GIT_MUTATION_FAILED_EXIT_CODE})
paths=[]
if action in ("stage","unstage","apply_hunk"):
    try:
        selected_path=verify_path_parent(repository_root,os.environ["RIFT_GIT_FILE"])
        paths.append(selected_path)
        renamed_from_value=os.environ.get("RIFT_GIT_RENAMED_FROM","")
        include_rename_source=os.environ.get("RIFT_GIT_INCLUDE_RENAME_SOURCE","") == "1"
        if include_rename_source and renamed_from_value:
            renamed_from=verify_path_parent(repository_root,renamed_from_value)
            if renamed_from != selected_path:
                paths.insert(0,renamed_from)
        elif include_rename_source or renamed_from_value:
            raise RuntimeError()
    except (KeyError,OSError,RuntimeError,RepositoryOutside):
        sys.exit(${GIT_MUTATION_FAILED_EXIT_CODE})
def valid_oid(value):
    return re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})",value) is not None
def parse_tree_entry(path,head_exists):
    if not head_exists:
        return None
    raw,truncated=capture_bounded(["ls-tree","-z","HEAD","--",path],environment,${MAX_WORKSPACE_PATH_LENGTH + 256},3,(0,))
    if truncated:
        raise RuntimeError()
    if not raw:
        return None
    if not raw.endswith(b"\\0") or raw.count(b"\\0") != 1:
        raise RuntimeError()
    metadata,record_path=raw[:-1].split(b"\\t",1)
    mode,object_type,oid=metadata.decode("ascii").split(" ")
    if record_path.decode("utf-8") != path or mode not in ("100644","100755","120000","160000") or object_type not in ("blob","commit") or not valid_oid(oid):
        raise RuntimeError()
    return {"mode":mode,"oid":oid}
def parse_index_entry(path):
    raw,truncated=capture_bounded(["ls-files","--stage","-z","--",path],environment,${MAX_WORKSPACE_PATH_LENGTH * 4 + 1024},3,(0,))
    if truncated:
        raise RuntimeError()
    entries={}
    for record in raw.split(b"\\0"):
        if not record:
            continue
        metadata,record_path=record.split(b"\\t",1)
        mode,oid,stage_value=metadata.decode("ascii").split(" ")
        stage=int(stage_value)
        if record_path.decode("utf-8") != path or mode not in ("100644","100755","120000","160000") or not valid_oid(oid) or stage not in (0,1,2,3):
            raise RuntimeError()
        entries[stage]={"mode":mode,"oid":oid}
    for stage in (0,2,3,1):
        if stage in entries:
            return entries[stage]
    return None
def open_parent(path):
    components=clean_relative(path).split("/")
    flags=os.O_RDONLY|os.O_DIRECTORY
    if hasattr(os,"O_CLOEXEC"):
        flags|=os.O_CLOEXEC
    if hasattr(os,"O_NOFOLLOW"):
        flags|=os.O_NOFOLLOW
    descriptor=os.dup(repository_descriptor)
    try:
        for component in components[:-1]:
            next_descriptor=os.open(component,flags,dir_fd=descriptor)
            os.close(descriptor)
            descriptor=next_descriptor
        return descriptor,components[-1]
    except Exception:
        os.close(descriptor)
        raise
def open_stage_entry(path,fallback_mode,core_filemode):
    try:
        parent,name=open_parent(path)
    except FileNotFoundError:
        return None
    try:
        try:
            path_stat=os.stat(name,dir_fd=parent,follow_symlinks=False)
        except FileNotFoundError:
            return None
        if stat.S_ISREG(path_stat.st_mode):
            flags=os.O_RDONLY
            if hasattr(os,"O_CLOEXEC"):
                flags|=os.O_CLOEXEC
            if hasattr(os,"O_NOFOLLOW"):
                flags|=os.O_NOFOLLOW
            descriptor=os.open(name,flags,dir_fd=parent)
            opened_stat=os.fstat(descriptor)
            if not stat.S_ISREG(opened_stat.st_mode):
                os.close(descriptor)
                raise RuntimeError()
            if opened_stat.st_size > ${MAX_GIT_STAGE_FILE_BYTES}:
                os.close(descriptor)
                result(False,action,"file_too_large")
            if not core_filemode and fallback_mode in ("100644","100755"):
                mode=fallback_mode
            else:
                mode="100755" if opened_stat.st_mode & 0o111 else "100644"
            return {"mode":mode,"fd":descriptor,"holder":None}
        if stat.S_ISLNK(path_stat.st_mode):
            target=os.fsencode(os.readlink(name,dir_fd=parent))
            if len(target) > ${MAX_GIT_STAGE_FILE_BYTES}:
                result(False,action,"file_too_large")
            holder=tempfile.TemporaryFile()
            holder.write(target)
            holder.seek(0)
            return {"mode":"120000","fd":holder.fileno(),"holder":holder}
        result(False,action,"unsupported_path")
    finally:
        os.close(parent)
def reject_content_conversion(path):
    conversion_attributes=("text","eol","ident","working-tree-encoding","crlf")
    attributes,truncated=capture_bounded(["check-attr","-a","-z","--",path],environment,65536,3,(0,))
    if truncated:
        raise RuntimeError()
    fields=attributes.split(b"\\0")
    if fields[-1] != b"" or (len(fields)-1) % 3 != 0:
        raise RuntimeError()
    for index in range(0,len(fields)-1,3):
        record=fields[index:index+3]
        attribute_name=record[1].decode("ascii")
        if record[0].decode("utf-8") != path:
            raise RuntimeError()
        attribute_value=record[2]
        if attribute_name == "filter":
            if attribute_value in (b"unset",b"unspecified"):
                driver=attribute_value.decode("ascii")
                configured,configured_truncated=capture_bounded(["config","--get-regexp","^filter\\."+driver+"\\.(clean|process|required)$"],environment,4096,3,(0,1))
                if configured_truncated:
                    raise RuntimeError()
                if not configured:
                    continue
            result(False,action,"unsafe_filter")
        elif attribute_name in conversion_attributes and attribute_value != b"unset":
            result(False,action,"content_conversion")
def hash_raw_entry(entry):
    os.lseek(entry["fd"],0,os.SEEK_SET)
    process=subprocess.Popen(["/usr/bin/git","--no-pager","--no-optional-locks","hash-object","-w","--no-filters","--stdin"],stdin=entry["fd"],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=environment,start_new_session=True,pass_fds=pinned_git_fds)
    try:
        stdout,_=process.communicate(timeout=10)
    except subprocess.TimeoutExpired:
        stop_process(process)
        result(False,action,"repository_busy")
    if process.returncode != 0:
        result(False,action,"git_command_failed")
    oid=stdout.rstrip(b"\\n").decode("ascii")
    if stdout.count(b"\\n") != 1 or not valid_oid(oid):
        raise RuntimeError()
    return oid
def update_index(records):
    return_code=run_quiet(["update-index","-z","--index-info"],environment,8,b"".join(records))
    if return_code is None:
        result(False,action,"repository_busy")
    if return_code != 0:
        result(False,action,"git_command_failed")
def index_record(path,entry,zero_oid):
    if entry is None:
        return ("0 "+zero_oid+"\\t"+path).encode("utf-8")+b"\\0"
    return (entry["mode"]+" "+entry["oid"]+"\\t"+path).encode("utf-8")+b"\\0"
if action == "apply_hunk":
    # The patch was already checked server-side to be one hunk confined to this
    # file (lib/workbench/hunk-patch-policy.ts). This re-derives the target from
    # the patch itself and refuses anything that does not match the path the
    # request verified, so a bypass of the server check still cannot write
    # somewhere else.
    try:
        patch_bytes=base64.b64decode(os.environ.get("RIFT_GIT_PATCH_B64",""),validate=True)
    except (binascii.Error,ValueError):
        sys.exit(${GIT_MUTATION_FAILED_EXIT_CODE})
    if not patch_bytes or len(patch_bytes) > ${MAX_HUNK_PATCH_BYTES}:
        sys.exit(${GIT_MUTATION_FAILED_EXIT_CODE})
    hunk_mode=os.environ.get("RIFT_GIT_HUNK_MODE","")
    if hunk_mode not in ("accept","reject"):
        sys.exit(${GIT_MUTATION_FAILED_EXIT_CODE})
    try:
        patch_text=patch_bytes.decode("utf-8")
    except UnicodeDecodeError:
        sys.exit(${GIT_MUTATION_FAILED_EXIT_CODE})
    if patch_text.count("\\n@@") + (1 if patch_text.startswith("@@") else 0) != 1:
        result(False,action,"not_single_hunk")
    declared=set()
    for patch_line in patch_text.split("\\n"):
        if patch_line.startswith("--- ") or patch_line.startswith("+++ "):
            candidate=patch_line[4:].split("\t")[0].strip()
            if candidate and candidate != "/dev/null":
                if candidate[:2] in ("a/","b/"):
                    candidate=candidate[2:]
                declared.add(candidate)
    if not declared or declared != {paths[0]}:
        result(False,action,"path_mismatch")
    # --cached stages the hunk without touching the working tree; -R reverses it
    # in the working tree. --check first, so a patch that would not apply
    # cleanly is refused instead of half-written.
    apply_args=["apply","--cached","--unidiff-zero"] if hunk_mode == "accept" else ["apply","-R","--unidiff-zero"]
    check_code=run_quiet(apply_args+["--check"],environment,8,patch_bytes)
    if check_code is None:
        result(False,action,"repository_busy")
    if check_code != 0:
        result(False,action,"patch_does_not_apply")
    apply_code=run_quiet(apply_args,environment,8,patch_bytes)
    if apply_code is None:
        result(False,action,"repository_busy")
    if apply_code != 0:
        result(False,action,"git_command_failed")
    result(True,action)
if action == "stage":
    try:
        object_format_raw,object_format_truncated=capture_bounded(["rev-parse","--show-object-format"],environment,16,3,(0,))
        object_format=object_format_raw.rstrip(b"\\n")
        if object_format_truncated or object_format not in (b"sha1",b"sha256"):
            raise RuntimeError()
        zero_oid="0"*(40 if object_format == b"sha1" else 64)
        filemode_raw,filemode_truncated=capture_bounded(["config","--bool","--get","core.filemode"],environment,16,3,(0,1))
        if filemode_truncated:
            raise RuntimeError()
        core_filemode=filemode_raw.rstrip(b"\\n") != b"false"
        autocrlf_raw,autocrlf_truncated=capture_bounded(["config","--get","core.autocrlf"],environment,32,3,(0,1))
        if autocrlf_truncated:
            raise RuntimeError()
        if autocrlf_raw.rstrip(b"\\n").lower() not in (b"",b"false",b"0",b"no",b"off"):
            result(False,action,"content_conversion")
        index_entries={path:parse_index_entry(path) for path in paths}
        shared_fallback=next((entry["mode"] for entry in index_entries.values() if entry and entry["mode"] in ("100644","100755")),None)
        records=[]
        for path in paths:
            fallback=index_entries[path]["mode"] if index_entries[path] else shared_fallback
            worktree_entry=open_stage_entry(path,fallback,core_filemode)
            if worktree_entry is None:
                records.append(index_record(path,None,zero_oid))
                continue
            reject_content_conversion(path)
            records.append(index_record(path,{"mode":worktree_entry["mode"],"oid":hash_raw_entry(worktree_entry)},zero_oid))
        update_index(records)
    except (OSError,RuntimeError,UnicodeDecodeError,UnicodeEncodeError,ValueError):
        sys.exit(${GIT_MUTATION_FAILED_EXIT_CODE})
    result(True,action)
if action == "unstage":
    head_status=run_quiet(["rev-parse","--verify","--quiet","HEAD"],environment,3)
    if head_status is None:
        result(False,action,"repository_busy")
    if head_status not in (0,1):
        result(False,action,"git_command_failed")
    try:
        object_format_raw,object_format_truncated=capture_bounded(["rev-parse","--show-object-format"],environment,16,3,(0,))
        object_format=object_format_raw.rstrip(b"\\n")
        if object_format_truncated or object_format not in (b"sha1",b"sha256"):
            raise RuntimeError()
        zero_oid="0"*(40 if object_format == b"sha1" else 64)
        records=[index_record(path,parse_tree_entry(path,head_status == 0),zero_oid) for path in paths]
        update_index(records)
    except (OSError,RuntimeError,UnicodeDecodeError,UnicodeEncodeError,ValueError):
        sys.exit(${GIT_MUTATION_FAILED_EXIT_CODE})
    result(True,action)
try:
    empty_worktree_holder=tempfile.TemporaryDirectory(dir="/tmp")
    empty_worktree_descriptor=os.open(empty_worktree_holder.name,os.O_RDONLY|os.O_DIRECTORY)
    pinned_git_fds=pinned_git_fds+(empty_worktree_descriptor,)
    environment["GIT_WORK_TREE"]=("/dev/fd/"+str(empty_worktree_descriptor)) if sys.platform.startswith("linux") else empty_worktree_holder.name
    os.fchdir(empty_worktree_descriptor)
    encoded_message=os.environ["RIFT_GIT_COMMIT_MESSAGE_B64"]
    expected_tree=os.environ["RIFT_GIT_EXPECTED_TREE"]
    expected_parent_value=os.environ.get("RIFT_GIT_EXPECTED_PARENT","")
    expected_parent=expected_parent_value or None
    expected_head_ref_value=os.environ.get("RIFT_GIT_EXPECTED_HEAD_REF","")
    expected_head_ref=expected_head_ref_value or None
    message_bytes=base64.b64decode(encoded_message,validate=True)
    message=message_bytes.decode("utf-8")
    if not message.strip() or len(message_bytes) > ${MAX_GIT_COMMIT_MESSAGE_BYTES} or b"\\0" in message_bytes or not valid_oid(expected_tree) or (expected_parent is not None and not valid_oid(expected_parent)):
        raise RuntimeError()
    if expected_head_ref is not None:
        if not expected_head_ref.startswith("refs/heads/") or any(ord(character) < 32 or ord(character) == 127 for character in expected_head_ref):
            raise RuntimeError()
        if run_quiet(["check-ref-format",expected_head_ref],environment,3) != 0:
            raise RuntimeError()
except (KeyError,binascii.Error,UnicodeDecodeError,RuntimeError):
    sys.exit(${GIT_MUTATION_FAILED_EXIT_CODE})
for operation_ref in ("MERGE_HEAD","CHERRY_PICK_HEAD","REVERT_HEAD","REBASE_HEAD"):
    operation_status=run_quiet(["rev-parse","--verify","--quiet",operation_ref],environment,3)
    if operation_status is None:
        result(False,action,"repository_busy")
    if operation_status == 0:
        result(False,action,"operation_in_progress")
    if operation_status != 1:
        result(False,action,"git_command_failed")
for state_name in ("rebase-merge","rebase-apply","sequencer","BISECT_LOG"):
    try:
        os.stat(state_name,dir_fd=git_descriptor,follow_symlinks=False)
        result(False,action,"operation_in_progress")
    except FileNotFoundError:
        pass
    except OSError:
        result(False,action,"git_command_failed")
try:
    tree_bytes,tree_truncated=capture_bounded(["write-tree"],environment,129,5,(0,))
    tree_oid=tree_bytes.rstrip(b"\\n").decode("ascii")
    if tree_truncated or tree_bytes.count(b"\\n") != 1 or not valid_oid(tree_oid):
        raise RuntimeError()
except (OSError,RuntimeError,UnicodeDecodeError):
    result(False,action,"git_command_failed")
if tree_oid != expected_tree:
    result(False,action,"index_changed")
head_status=run_quiet(["rev-parse","--verify","--quiet","HEAD"],environment,3)
if head_status is None:
    result(False,action,"repository_busy")
current_head_ref_raw,current_head_ref_truncated=capture_bounded(["symbolic-ref","--quiet","HEAD"],environment,${MAX_WORKSPACE_PATH_LENGTH + 1},3,(0,1))
current_head_ref=current_head_ref_raw.rstrip(b"\\n").decode("utf-8") if current_head_ref_raw else None
if current_head_ref_truncated or (current_head_ref is not None and current_head_ref_raw.count(b"\\n") != 1):
    result(False,action,"git_command_failed")
if current_head_ref != expected_head_ref:
    result(False,action,"index_changed")
parent_oid=None
if head_status == 0:
    try:
        parent_bytes,parent_truncated=capture_bounded(["rev-parse","--verify","HEAD"],environment,129,3,(0,))
        parent_oid=parent_bytes.rstrip(b"\\n").decode("ascii")
        head_tree_bytes,head_tree_truncated=capture_bounded(["rev-parse","--verify","HEAD^{tree}"],environment,129,3,(0,))
        head_tree_oid=head_tree_bytes.rstrip(b"\\n").decode("ascii")
        if parent_truncated or head_tree_truncated or parent_bytes.count(b"\\n") != 1 or head_tree_bytes.count(b"\\n") != 1 or not valid_oid(parent_oid) or not valid_oid(head_tree_oid):
            raise RuntimeError()
    except (OSError,RuntimeError,UnicodeDecodeError):
        result(False,action,"git_command_failed")
    if parent_oid != expected_parent:
        result(False,action,"index_changed")
    if head_tree_oid == tree_oid:
        result(False,action,"nothing_staged")
elif head_status == 1:
    if expected_parent is not None:
        result(False,action,"index_changed")
    try:
        initial_entries,initial_truncated=capture_bounded(["ls-tree","-r","-z",tree_oid],environment,1,3,(0,))
    except (OSError,RuntimeError):
        result(False,action,"git_command_failed")
    if not initial_entries and not initial_truncated:
        result(False,action,"nothing_staged")
else:
    result(False,action,"git_command_failed")
identity_status=run_quiet(["var","GIT_AUTHOR_IDENT"],environment,3)
if identity_status is None:
    result(False,action,"repository_busy")
if identity_status != 0:
    result(False,action,"identity_required")
try:
    commit_arguments=["commit-tree",tree_oid]
    if parent_oid is not None:
        commit_arguments.extend(["-p",parent_oid])
    commit_arguments.extend(["-F","-"])
    oid_bytes=capture_git_with_input(commit_arguments,environment,message_bytes+b"\\n",129,12)
    oid=oid_bytes.rstrip(b"\\n").decode("ascii")
    if oid_bytes.count(b"\\n") != 1 or not valid_oid(oid):
        raise RuntimeError()
except (OSError,RuntimeError,UnicodeDecodeError):
    result(False,action,"git_command_failed")
zero_oid="0"*len(tree_oid)
update_target=expected_head_ref or "HEAD"
update_arguments=["update-ref","--no-deref"]
update_arguments.extend(["-m","RIFT Workbench commit",update_target,oid,parent_oid or zero_oid])
update_status=run_quiet(update_arguments,environment,5)
if update_status is None:
    result(False,action,"repository_busy")
if update_status != 0:
    result(False,action,"index_changed")
result(True,action,oid=oid)'`;
