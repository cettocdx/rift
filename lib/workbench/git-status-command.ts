import { z } from "zod";

export const MAX_GIT_STATUS_FILES = 500;
export const MAX_GIT_STATUS_RECORDS = MAX_GIT_STATUS_FILES + 1;
export const MAX_GIT_STATUS_BYTES = 2 * 1024 * 1024;
export const GIT_NOT_REPOSITORY_EXIT_CODE = 47;
export const GIT_STATUS_FAILED_EXIT_CODE = 48;
export const GIT_REPOSITORY_OUTSIDE_EXIT_CODE = 49;

const MAX_GIT_PATH_BYTES = 1024;
const MAX_GIT_ROOT_BYTES = 4096;

const gitFileStatusSchema = z
  .object({
    name: z.string().min(1).max(MAX_GIT_PATH_BYTES),
    status: z.enum([
      "conflict",
      "renamed",
      "copied",
      "deleted",
      "added",
      "modified",
      "typechange",
      "untracked",
      "unknown",
    ]),
    indexStatus: z.string().length(1),
    workingTreeStatus: z.string().length(1),
    staged: z.boolean(),
    renamedFrom: z.string().min(1).max(MAX_GIT_PATH_BYTES).optional(),
  })
  .strict();

const gitRootCommandSchema = z
  .object({
    repositoryRoot: z.string().min(1).max(MAX_GIT_ROOT_BYTES),
  })
  .strict();

const gitStatusCommandSchema = z
  .object({
    currentBranch: z.string().min(1).max(MAX_GIT_PATH_BYTES).optional(),
    upstream: z.string().min(1).max(MAX_GIT_PATH_BYTES).optional(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    detached: z.boolean(),
    fileStatus: z.array(gitFileStatusSchema).max(MAX_GIT_STATUS_FILES),
    truncated: z.boolean(),
  })
  .strict();

export type BoundedGitStatus = z.infer<typeof gitStatusCommandSchema>;

export class WorkbenchGitPayloadError extends Error {
  constructor() {
    super("The sandbox returned an invalid Git response.");
    this.name = "WorkbenchGitPayloadError";
  }
}

function parseJsonPayload<T>(stdout: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new WorkbenchGitPayloadError();
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new WorkbenchGitPayloadError();
  return parsed.data;
}

export function parseGitRootCommand(stdout: string) {
  return parseJsonPayload(stdout, gitRootCommandSchema);
}

export function parseGitStatusCommand(stdout: string) {
  return parseJsonPayload(stdout, gitStatusCommandSchema);
}

export function createReadOnlyGitEnvs(
  repositoryRoot?: string,
  home = "/home/user",
) {
  const configEntries: Array<[string, string]> = [
    ["core.fsmonitor", "false"],
    ["core.hooksPath", "/dev/null"],
    ["core.preloadIndex", "false"],
    ["core.untrackedCache", "false"],
    ["index.threads", "1"],
  ];
  if (repositoryRoot) {
    configEntries.unshift(["safe.directory", repositoryRoot]);
  }

  const envs: Record<string, string> = {
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
    XDG_CONFIG_HOME: "/nonexistent",
    GIT_ASKPASS: "/bin/false",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_LITERAL_PATHSPECS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "/bin/cat",
    GIT_SSH_COMMAND: "/bin/false",
    GIT_TERMINAL_PROMPT: "0",
    PAGER: "/bin/cat",
    SSH_ASKPASS: "/bin/false",
    TMPDIR: "/tmp",
    GIT_CONFIG_COUNT: String(configEntries.length),
  };

  for (const [index, [key, value]] of configEntries.entries()) {
    envs[`GIT_CONFIG_KEY_${index}`] = key;
    envs[`GIT_CONFIG_VALUE_${index}`] = value;
  }
  return envs;
}

// Both helpers are static server-owned commands. The shell only forwards a
// small set of quoted RIFT values into an isolated Python process. Python then
// invokes the absolute system Git binary with a fresh allowlisted environment.
const ISOLATED_PYTHON_ENV =
  '/usr/bin/env -i RIFT_ROOT="$RIFT_ROOT" LANG=C LC_ALL=C TMPDIR=/tmp';

export const FIND_GIT_ROOT_COMMAND = `${ISOLATED_PYTHON_ENV} RIFT_GIT_CWD="$RIFT_GIT_CWD" /usr/bin/python3 -I -S -c 'import json,os,signal,subprocess,sys
class RepositoryOutside(Exception):
    pass
def clean_absolute(value):
    if not value or not os.path.isabs(value) or os.path.normpath(value) != value:
        raise RepositoryOutside()
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
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
    try:
        descriptor=os.open(workspace_root,flags)
        relative=os.path.relpath(target,workspace_root)
        if relative == ".":
            return descriptor
        for component in relative.split(os.sep):
            if component in ("",".",".."):
                raise RepositoryOutside()
            next_descriptor=os.open(component,flags,dir_fd=descriptor)
            os.close(descriptor)
            descriptor=next_descriptor
        return descriptor
    except OSError:
        try:
            os.close(descriptor)
        except (OSError,UnboundLocalError):
            pass
        raise RepositoryOutside()
def git_environment(workspace_root,safe_directory):
    entries=[("safe.directory",safe_directory),("core.fsmonitor","false"),("core.hooksPath","/dev/null"),("core.preloadIndex","false"),("core.untrackedCache","false"),("index.threads","1")]
    environment={"HOME":workspace_root,"LANG":"C","LC_ALL":"C","PATH":"/usr/bin:/bin","XDG_CONFIG_HOME":"/nonexistent","GIT_ASKPASS":"/bin/false","SSH_ASKPASS":"/bin/false","GIT_CONFIG_GLOBAL":"/dev/null","GIT_CONFIG_NOSYSTEM":"1","GIT_CONFIG_SYSTEM":"/dev/null","GIT_LITERAL_PATHSPECS":"1","GIT_NO_LAZY_FETCH":"1","GIT_NO_REPLACE_OBJECTS":"1","GIT_OPTIONAL_LOCKS":"0","GIT_PAGER":"/bin/cat","PAGER":"/bin/cat","GIT_SSH_COMMAND":"/bin/false","GIT_TERMINAL_PROMPT":"0","GIT_CONFIG_COUNT":str(len(entries))}
    for index,(key,value) in enumerate(entries):
        environment["GIT_CONFIG_KEY_"+str(index)]=key
        environment["GIT_CONFIG_VALUE_"+str(index)]=value
    return environment
def stop_process(process):
    try:
        os.killpg(process.pid,signal.SIGKILL)
    except OSError:
        try:
            process.kill()
        except OSError:
            pass
    process.wait()
def run_git(arguments,environment,failure_code):
    # Retry only a timed-out read; reap the old process before trying again.
    for attempt in range(2):
        process=subprocess.Popen(["/usr/bin/git","--no-optional-locks"]+arguments,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=environment,start_new_session=True)
        try:
            stdout,_=process.communicate(timeout=3)
            break
        except subprocess.TimeoutExpired:
            stop_process(process)
            if attempt == 1:
                sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
    if process.returncode != 0:
        sys.exit(failure_code)
    if len(stdout) > ${MAX_GIT_ROOT_BYTES + 1}:
        sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
    return stdout
def decode_absolute_line(raw):
    if not raw.endswith(b"\\n") or raw.count(b"\\n") != 1:
        sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
    value=raw[:-1]
    if not value or len(value) > ${MAX_GIT_ROOT_BYTES}:
        sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
    try:
        text=value.decode("utf-8")
    except UnicodeDecodeError:
        sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
    try:
        return clean_absolute(text)
    except RepositoryOutside:
        sys.exit(${GIT_REPOSITORY_OUTSIDE_EXIT_CODE})
try:
    workspace_root=clean_absolute(os.environ["RIFT_ROOT"])
    requested_cwd=clean_absolute(os.environ["RIFT_GIT_CWD"])
    cwd_descriptor=open_directory_beneath(workspace_root,requested_cwd)
    os.fchdir(cwd_descriptor)
except (KeyError,RepositoryOutside,OSError):
    sys.exit(${GIT_REPOSITORY_OUTSIDE_EXIT_CODE})
environment=git_environment(workspace_root,requested_cwd)
repository_root=decode_absolute_line(run_git(["rev-parse","--show-toplevel"],environment,${GIT_NOT_REPOSITORY_EXIT_CODE}))
try:
    if os.path.commonpath([repository_root,requested_cwd]) != repository_root:
        raise RepositoryOutside()
    repository_descriptor=open_directory_beneath(workspace_root,repository_root)
    os.close(repository_descriptor)
except (RepositoryOutside,ValueError):
    sys.exit(${GIT_REPOSITORY_OUTSIDE_EXIT_CODE})
environment=git_environment(workspace_root,repository_root)
git_directory=decode_absolute_line(run_git(["rev-parse","--absolute-git-dir"],environment,${GIT_STATUS_FAILED_EXIT_CODE}))
common_directory=decode_absolute_line(run_git(["rev-parse","--path-format=absolute","--git-common-dir"],environment,${GIT_STATUS_FAILED_EXIT_CODE}))
try:
    git_descriptor=open_directory_beneath(workspace_root,git_directory)
    os.close(git_descriptor)
    common_descriptor=open_directory_beneath(workspace_root,common_directory)
    os.close(common_descriptor)
except RepositoryOutside:
    sys.exit(${GIT_REPOSITORY_OUTSIDE_EXIT_CODE})
print(json.dumps({"repositoryRoot":repository_root},separators=(",",":")))'`;

export const BOUNDED_GIT_STATUS_COMMAND = `${ISOLATED_PYTHON_ENV} RIFT_REPOSITORY_ROOT="$RIFT_REPOSITORY_ROOT" RIFT_GIT_MAX_BYTES="$RIFT_GIT_MAX_BYTES" RIFT_GIT_MAX_RECORDS="$RIFT_GIT_MAX_RECORDS" /usr/bin/python3 -I -S -c 'import json,os,posixpath,re,select,signal,subprocess,sys,time
pinned_git_fds=()
class ParseFailure(Exception):
    pass
class RepositoryOutside(Exception):
    pass
def clean_absolute(value):
    if not value or not os.path.isabs(value) or os.path.normpath(value) != value:
        raise RepositoryOutside()
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
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
    try:
        descriptor=os.open(workspace_root,flags)
        relative=os.path.relpath(target,workspace_root)
        if relative == ".":
            return descriptor
        for component in relative.split(os.sep):
            if component in ("",".",".."):
                raise RepositoryOutside()
            next_descriptor=os.open(component,flags,dir_fd=descriptor)
            os.close(descriptor)
            descriptor=next_descriptor
        return descriptor
    except OSError:
        try:
            os.close(descriptor)
        except (OSError,UnboundLocalError):
            pass
        raise RepositoryOutside()
def git_environment(workspace_root,safe_directory):
    entries=[("safe.directory",safe_directory),("core.fsmonitor","false"),("core.hooksPath","/dev/null"),("core.preloadIndex","false"),("core.untrackedCache","false"),("index.threads","1")]
    environment={"HOME":workspace_root,"LANG":"C","LC_ALL":"C","PATH":"/usr/bin:/bin","XDG_CONFIG_HOME":"/nonexistent","GIT_ASKPASS":"/bin/false","SSH_ASKPASS":"/bin/false","GIT_CONFIG_GLOBAL":"/dev/null","GIT_CONFIG_NOSYSTEM":"1","GIT_CONFIG_SYSTEM":"/dev/null","GIT_LITERAL_PATHSPECS":"1","GIT_NO_LAZY_FETCH":"1","GIT_NO_REPLACE_OBJECTS":"1","GIT_OPTIONAL_LOCKS":"0","GIT_PAGER":"/bin/cat","PAGER":"/bin/cat","GIT_SSH_COMMAND":"/bin/false","GIT_TERMINAL_PROMPT":"0","GIT_CONFIG_COUNT":str(len(entries))}
    for index,(key,value) in enumerate(entries):
        environment["GIT_CONFIG_KEY_"+str(index)]=key
        environment["GIT_CONFIG_VALUE_"+str(index)]=value
    return environment
def stop_process(process):
    try:
        os.killpg(process.pid,signal.SIGKILL)
    except OSError:
        try:
            process.kill()
        except OSError:
            pass
    process.wait()
def run_git_line(arguments,environment,failure_code):
    # Retry only a timed-out read; reap the old process before trying again.
    for attempt in range(2):
        process=subprocess.Popen(["/usr/bin/git","--no-optional-locks"]+arguments,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=environment,start_new_session=True,pass_fds=pinned_git_fds)
        try:
            stdout,_=process.communicate(timeout=3)
            break
        except subprocess.TimeoutExpired:
            stop_process(process)
            if attempt == 1:
                sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
    if process.returncode != 0:
        sys.exit(failure_code)
    if not stdout.endswith(b"\\n") or stdout.count(b"\\n") != 1 or len(stdout) > ${MAX_GIT_ROOT_BYTES + 1}:
        sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
    try:
        value=stdout[:-1].decode("utf-8")
    except UnicodeDecodeError:
        sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
    try:
        return clean_absolute(value)
    except RepositoryOutside:
        sys.exit(${GIT_REPOSITORY_OUTSIDE_EXIT_CODE})
def disable_filter_commands(environment):
    process=subprocess.Popen(["/usr/bin/git","--no-optional-locks","config","--null","--name-only","--get-regexp","^filter\\..*\\.(clean|process|required|smudge)$"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=environment,start_new_session=True,pass_fds=pinned_git_fds)
    try:
        stdout,_=process.communicate(timeout=3)
    except subprocess.TimeoutExpired:
        stop_process(process)
        raise ParseFailure()
    if process.returncode not in (0,1) or len(stdout) > 65536:
        raise ParseFailure()
    drivers=set()
    for raw_key in stdout.split(b"\\0"):
        if not raw_key:
            continue
        try:
            key=raw_key.decode("utf-8")
        except UnicodeDecodeError:
            raise ParseFailure()
        match=re.fullmatch(r"filter\\.(.+)\\.(clean|process|required|smudge)",key,re.IGNORECASE)
        if match is None or any(ord(character) < 32 or ord(character) == 127 for character in key):
            raise ParseFailure()
        drivers.add(match.group(1))
    if len(drivers) > 128:
        raise ParseFailure()
    next_index=int(environment["GIT_CONFIG_COUNT"])
    for driver in sorted(drivers):
        for suffix,value in (("clean",""),("process",""),("smudge",""),("required","false")):
            environment["GIT_CONFIG_KEY_"+str(next_index)]="filter."+driver+"."+suffix
            environment["GIT_CONFIG_VALUE_"+str(next_index)]=value
            next_index+=1
    environment["GIT_CONFIG_COUNT"]=str(next_index)
def decode_text(value):
    if not value or len(value) > ${MAX_GIT_PATH_BYTES}:
        raise ParseFailure()
    try:
        text=value.decode("utf-8")
    except UnicodeDecodeError:
        raise ParseFailure()
    if any(ord(character) < 32 or ord(character) == 127 for character in text):
        raise ParseFailure()
    return text
def decode_repository_path(value):
    text=decode_text(value)
    if "\\\\" in text or text.startswith("/") or text in (".",".."):
        raise ParseFailure()
    components=text.split("/")
    if any(component in ("",".","..") for component in components):
        raise ParseFailure()
    if posixpath.normpath(text) != text:
        raise ParseFailure()
    return text
def valid_xy(value,allowed,require_rename=False):
    try:
        text=value.decode("ascii")
    except UnicodeDecodeError:
        raise ParseFailure()
    if len(text) != 2 or text == ".." or any(character not in allowed for character in text):
        raise ParseFailure()
    if require_rename and "R" not in text and "C" not in text:
        raise ParseFailure()
    return text
def validate_submodule(value):
    if re.fullmatch(b"(?:N\\.\\.\\.|S[.C][.M][.U])",value) is None:
        raise ParseFailure()
def validate_modes(values):
    if any(re.fullmatch(b"[0-7]{6}",value) is None for value in values):
        raise ParseFailure()
def validate_hashes(values):
    if any(re.fullmatch(b"(?:[0-9a-f]{40}|[0-9a-f]{64})",value) is None for value in values):
        raise ParseFailure()
def normalize_code(value):
    return " " if value == "." else value
def status_label(kind,index_status,working_status):
    codes={index_status,working_status}
    if kind == "u":
        return "conflict"
    if "R" in codes:
        return "renamed"
    if "C" in codes:
        return "copied"
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
    raise ParseFailure()
def make_entry(kind,xy,path_value):
    path=decode_repository_path(path_value)
    index_status=normalize_code(xy[0])
    working_status=normalize_code(xy[1])
    return {"name":path,"status":status_label(kind,index_status,working_status),"indexStatus":index_status,"workingTreeStatus":working_status,"staged":index_status not in (" ","?")}
try:
    workspace_root=clean_absolute(os.environ["RIFT_ROOT"])
    repository_root=clean_absolute(os.environ["RIFT_REPOSITORY_ROOT"])
    max_bytes=int(os.environ["RIFT_GIT_MAX_BYTES"])
    max_records=int(os.environ["RIFT_GIT_MAX_RECORDS"])
except (KeyError,ValueError,RepositoryOutside):
    sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
if max_bytes < 1 or max_bytes > ${MAX_GIT_STATUS_BYTES} or max_records < 2 or max_records > ${MAX_GIT_STATUS_RECORDS}:
    sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
try:
    repository_descriptor=open_directory_beneath(workspace_root,repository_root)
    os.fchdir(repository_descriptor)
except (RepositoryOutside,OSError):
    sys.exit(${GIT_REPOSITORY_OUTSIDE_EXIT_CODE})
environment=git_environment(workspace_root,repository_root)
verified_root=run_git_line(["rev-parse","--show-toplevel"],environment,${GIT_STATUS_FAILED_EXIT_CODE})
if verified_root != repository_root:
    sys.exit(${GIT_REPOSITORY_OUTSIDE_EXIT_CODE})
git_directory=run_git_line(["rev-parse","--absolute-git-dir"],environment,${GIT_STATUS_FAILED_EXIT_CODE})
common_directory=run_git_line(["rev-parse","--path-format=absolute","--git-common-dir"],environment,${GIT_STATUS_FAILED_EXIT_CODE})
try:
    git_descriptor=open_directory_beneath(workspace_root,git_directory)
    common_descriptor=open_directory_beneath(workspace_root,common_directory)
except RepositoryOutside:
    sys.exit(${GIT_REPOSITORY_OUTSIDE_EXIT_CODE})
pinned_git_fds=(repository_descriptor,git_descriptor,common_descriptor)
if sys.platform.startswith("linux"):
    environment["GIT_DIR"]="/dev/fd/"+str(git_descriptor)
    environment["GIT_COMMON_DIR"]="/dev/fd/"+str(common_descriptor)
    environment["GIT_WORK_TREE"]="/dev/fd/"+str(repository_descriptor)
else:
    environment["GIT_DIR"]=git_directory
    environment["GIT_COMMON_DIR"]=common_directory
    environment["GIT_WORK_TREE"]=repository_root
try:
    disable_filter_commands(environment)
except ParseFailure:
    sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
command=["/usr/bin/git","--no-optional-locks","status","--porcelain=v2","-z","--branch","--untracked-files=all","--ignore-submodules=all","--renames"]
process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=environment,start_new_session=True,pass_fds=pinned_git_fds)
buffer=bytearray()
bytes_read=0
file_records=0
files=[]
truncated=False
pending_rename=None
current_branch=None
upstream=None
ahead=0
behind=0
detached=False
seen_headers=set()
deadline=time.monotonic()+7
try:
    while not truncated:
        remaining=max_bytes-bytes_read
        wait_time=deadline-time.monotonic()
        if wait_time <= 0:
            raise ParseFailure()
        readable,_,_=select.select([process.stdout.fileno()],[],[],wait_time)
        if not readable:
            raise ParseFailure()
        chunk=os.read(process.stdout.fileno(),min(65536,remaining+1))
        if not chunk:
            break
        over_limit=len(chunk) > remaining
        accepted=chunk[:remaining]
        bytes_read+=len(accepted)
        buffer.extend(accepted)
        while not truncated:
            delimiter=buffer.find(0)
            if delimiter < 0:
                break
            record=bytes(buffer[:delimiter])
            del buffer[:delimiter+1]
            if pending_rename is not None:
                pending_rename["renamedFrom"]=decode_repository_path(record)
                files.append(pending_rename)
                pending_rename=None
                continue
            if record.startswith(b"# "):
                if record.startswith(b"# branch.oid "):
                    header="oid"
                    oid=record[len(b"# branch.oid "):]
                    if oid != b"(initial)" and re.fullmatch(b"(?:[0-9a-f]{40}|[0-9a-f]{64})",oid) is None:
                        raise ParseFailure()
                elif record.startswith(b"# branch.head "):
                    header="head"
                    head=decode_text(record[len(b"# branch.head "):])
                    if head == "(detached)":
                        detached=True
                    else:
                        current_branch=head
                elif record.startswith(b"# branch.upstream "):
                    header="upstream"
                    upstream=decode_text(record[len(b"# branch.upstream "):])
                elif record.startswith(b"# branch.ab "):
                    header="ab"
                    match=re.fullmatch(b"\\+([0-9]+) -([0-9]+)",record[len(b"# branch.ab "):])
                    if match is None:
                        raise ParseFailure()
                    ahead=int(match.group(1))
                    behind=int(match.group(2))
                    if ahead > 2147483647 or behind > 2147483647:
                        raise ParseFailure()
                else:
                    raise ParseFailure()
                if header in seen_headers:
                    raise ParseFailure()
                seen_headers.add(header)
                continue
            file_records+=1
            if file_records >= max_records:
                truncated=True
                break
            if record.startswith(b"1 "):
                fields=record.split(b" ",8)
                if len(fields) != 9:
                    raise ParseFailure()
                xy=valid_xy(fields[1],".MADT")
                validate_submodule(fields[2])
                validate_modes(fields[3:6])
                validate_hashes(fields[6:8])
                files.append(make_entry("1",xy,fields[8]))
            elif record.startswith(b"2 "):
                fields=record.split(b" ",9)
                if len(fields) != 10:
                    raise ParseFailure()
                xy=valid_xy(fields[1],".MADTRC",True)
                validate_submodule(fields[2])
                validate_modes(fields[3:6])
                validate_hashes(fields[6:8])
                score=fields[8]
                if re.fullmatch(b"[RC][0-9]{1,3}",score) is None or int(score[1:]) > 100 or chr(score[0]) not in xy:
                    raise ParseFailure()
                pending_rename=make_entry("2",xy,fields[9])
            elif record.startswith(b"u "):
                fields=record.split(b" ",10)
                if len(fields) != 11:
                    raise ParseFailure()
                try:
                    xy=fields[1].decode("ascii")
                except UnicodeDecodeError:
                    raise ParseFailure()
                if xy not in ("DD","AU","UD","UA","DU","AA","UU"):
                    raise ParseFailure()
                validate_submodule(fields[2])
                validate_modes(fields[3:7])
                validate_hashes(fields[7:10])
                files.append(make_entry("u",xy,fields[10]))
            elif record.startswith(b"? "):
                files.append(make_entry("?","??",record[2:]))
            else:
                raise ParseFailure()
        if over_limit:
            truncated=True
    if truncated:
        stop_process(process)
    else:
        try:
            return_code=process.wait(timeout=max(0.1,deadline-time.monotonic()))
        except subprocess.TimeoutExpired:
            stop_process(process)
            raise ParseFailure()
        if return_code != 0 or buffer or pending_rename is not None or "oid" not in seen_headers or "head" not in seen_headers:
            raise ParseFailure()
except ParseFailure:
    if process.poll() is None:
        stop_process(process)
    sys.exit(${GIT_STATUS_FAILED_EXIT_CODE})
payload={"ahead":ahead,"behind":behind,"detached":detached,"fileStatus":files,"truncated":truncated}
if current_branch is not None:
    payload["currentBranch"]=current_branch
if upstream is not None:
    payload["upstream"]=upstream
print(json.dumps(payload,separators=(",",":")))'`;
