export const WORKBENCH_STATE_ROOT = "/home/user/.rift-workbench-state";

export const PREPARE_WORKBENCH_STATE_COMMAND = `/usr/bin/python3 -c 'import errno,os,stat,sys
home_fd=None
state_fd=None
try:
    home_fd=os.open(os.environ["RIFT_HOME"],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        os.mkdir(".rift-workbench-state",0o700,dir_fd=home_fd)
    except FileExistsError:
        pass
    state_fd=os.open(".rift-workbench-state",os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=home_fd)
    if not stat.S_ISDIR(os.fstat(state_fd).st_mode):
        sys.exit(41)
    os.fchmod(state_fd,0o700)
    for name in ("locks","tmp"):
        try:
            os.mkdir(name,0o700,dir_fd=state_fd)
        except FileExistsError:
            pass
        child_fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=state_fd)
        os.fchmod(child_fd,0o700)
        os.close(child_fd)
except OSError as error:
    if error.errno in (errno.ELOOP,errno.ENOTDIR):
        sys.exit(41)
    raise
finally:
    if state_fd is not None:
        os.close(state_fd)
    if home_fd is not None:
        os.close(home_fd)'`;

export const VERIFY_DIRECTORY_COMMAND = `/usr/bin/python3 -c 'import errno,os,sys
fd=None
try:
    fd=os.open(os.environ["RIFT_ROOT"],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    for segment in [item for item in os.environ["RIFT_RELATIVE"].split("/") if item]:
        next_fd=os.open(segment,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
        os.close(fd)
        fd=next_fd
except FileNotFoundError:
    sys.exit(44)
except OSError as error:
    if error.errno in (errno.ELOOP,errno.ENOTDIR):
        sys.exit(41)
    raise
finally:
    if fd is not None:
        os.close(fd)'`;

export const LIST_DIRECTORY_COMMAND = `/usr/bin/python3 -c 'import datetime,errno,json,os,stat,sys
def iso_time(value):
    return datetime.datetime.fromtimestamp(value,datetime.timezone.utc).isoformat().replace("+00:00","Z")
fd=None
try:
    fd=os.open(os.environ["RIFT_ROOT"],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    for segment in [item for item in os.environ["RIFT_RELATIVE"].split("/") if item]:
        next_fd=os.open(segment,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
        os.close(fd)
        fd=next_fd
    entries=[]
    source_truncated=False
    scan_limit=int(os.environ["RIFT_SCAN_LIMIT"])
    with os.scandir(fd) as iterator:
        for entry in iterator:
            if len(entries) >= scan_limit:
                source_truncated=True
                break
            try:
                entry.name.encode("utf-8")
                info=entry.stat(follow_symlinks=False)
            except (FileNotFoundError,UnicodeEncodeError):
                continue
            if stat.S_ISLNK(info.st_mode):
                continue
            if stat.S_ISDIR(info.st_mode):
                kind="directory"
            elif stat.S_ISREG(info.st_mode):
                kind="file"
            else:
                continue
            entries.append({"name":entry.name,"type":kind,"size":info.st_size,"modifiedAt":iso_time(info.st_mtime)})
    entries.sort(key=lambda item:(item["type"] != "directory",item["name"].casefold(),item["name"]))
    print(json.dumps({"entries":entries,"sourceTruncated":source_truncated},separators=(",",":")))
except FileNotFoundError:
    sys.exit(44)
except OSError as error:
    if error.errno in (errno.ELOOP,errno.ENOTDIR):
        sys.exit(41)
    raise
finally:
    if fd is not None:
        os.close(fd)'`;

export const READ_FILE_COMMAND = `/usr/bin/python3 -c 'import base64,datetime,errno,json,os,stat,sys
def iso_time(value):
    return datetime.datetime.fromtimestamp(value,datetime.timezone.utc).isoformat().replace("+00:00","Z")
parent_fd=None
file_fd=None
try:
    parts=[item for item in os.environ["RIFT_RELATIVE"].split("/") if item]
    if not parts:
        sys.exit(46)
    parent_fd=os.open(os.environ["RIFT_ROOT"],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    for segment in parts[:-1]:
        next_fd=os.open(segment,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent_fd)
        os.close(parent_fd)
        parent_fd=next_fd
    file_fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent_fd)
    initial_info=os.fstat(file_fd)
    if not stat.S_ISREG(initial_info.st_mode):
        sys.exit(46)
    limit=int(os.environ["RIFT_MAX_BYTES"])
    if initial_info.st_size > limit:
        sys.exit(45)
    initial_snapshot=(initial_info.st_dev,initial_info.st_ino,initial_info.st_size,initial_info.st_mtime_ns)
    chunks=[]
    total=0
    while True:
        chunk=os.read(file_fd,min(65536,limit+1-total))
        if not chunk:
            break
        chunks.append(chunk)
        total+=len(chunk)
        if total > limit:
            sys.exit(45)
    data=b"".join(chunks)
    final_info=os.fstat(file_fd)
    final_snapshot=(final_info.st_dev,final_info.st_ino,final_info.st_size,final_info.st_mtime_ns)
    if final_snapshot != initial_snapshot or len(data) != initial_info.st_size:
        sys.exit(47)
    print(json.dumps({"data":base64.b64encode(data).decode("ascii"),"size":len(data),"modifiedAt":iso_time(final_info.st_mtime)},separators=(",",":")))
except FileNotFoundError:
    sys.exit(44)
except OSError as error:
    if error.errno in (errno.ELOOP,errno.ENOTDIR):
        sys.exit(41)
    raise
finally:
    if file_fd is not None:
        os.close(file_fd)
    if parent_fd is not None:
        os.close(parent_fd)'`;

export const ATOMIC_SAVE_COMMAND = `/usr/bin/python3 -c 'import datetime,errno,fcntl,hashlib,json,os,stat,sys
def iso_time(value):
    return datetime.datetime.fromtimestamp(value,datetime.timezone.utc).isoformat().replace("+00:00","Z")
def hash_fd(fd):
    os.lseek(fd,0,os.SEEK_SET)
    digest=hashlib.sha256()
    while True:
        chunk=os.read(fd,65536)
        if not chunk:
            break
        digest.update(chunk)
    return digest.hexdigest()
parent_fd=None
target_fd=None
state_fd=None
locks_fd=None
tmp_fd=None
lock_fd=None
temp_fd=None
try:
    relative=os.environ["RIFT_RELATIVE"]
    parts=[item for item in relative.split("/") if item]
    if not parts:
        sys.exit(46)
    state_fd=os.open(os.environ["RIFT_STATE_ROOT"],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    locks_fd=os.open("locks",os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=state_fd)
    tmp_fd=os.open("tmp",os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=state_fd)
    lock_name=hashlib.sha256(relative.encode("utf-8")).hexdigest()+".lock"
    lock_fd=os.open(lock_name,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600,dir_fd=locks_fd)
    if not stat.S_ISREG(os.fstat(lock_fd).st_mode):
        sys.exit(41)
    fcntl.flock(lock_fd,fcntl.LOCK_EX)
    temp_name=os.environ["RIFT_TEMP_NAME"]
    if not temp_name or "/" in temp_name or temp_name in (".",".."):
        sys.exit(43)
    temp_fd=os.open(temp_name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=tmp_fd)
    temp_info=os.fstat(temp_fd)
    if not stat.S_ISREG(temp_info.st_mode) or temp_info.st_size > int(os.environ["RIFT_MAX_BYTES"]):
        sys.exit(43)
    if hash_fd(temp_fd) != os.environ["RIFT_NEXT_REVISION"]:
        sys.exit(43)
    parent_fd=os.open(os.environ["RIFT_ROOT"],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    for segment in parts[:-1]:
        next_fd=os.open(segment,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent_fd)
        os.close(parent_fd)
        parent_fd=next_fd
    target_fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent_fd)
    target_info=os.fstat(target_fd)
    if not stat.S_ISREG(target_info.st_mode):
        sys.exit(46)
    current=hash_fd(target_fd)
    if current != os.environ["RIFT_EXPECTED_REVISION"]:
        print(current)
        sys.exit(42)
    current_name_info=os.stat(parts[-1],dir_fd=parent_fd,follow_symlinks=False)
    final_info=os.fstat(target_fd)
    if stat.S_ISLNK(current_name_info.st_mode) or current_name_info.st_dev != target_info.st_dev or current_name_info.st_ino != target_info.st_ino or final_info.st_mtime_ns != target_info.st_mtime_ns or final_info.st_size != target_info.st_size:
        print(hash_fd(target_fd))
        sys.exit(42)
    os.fchmod(temp_fd,stat.S_IMODE(target_info.st_mode))
    os.fsync(temp_fd)
    os.replace(temp_name,parts[-1],src_dir_fd=tmp_fd,dst_dir_fd=parent_fd)
    os.fsync(parent_fd)
    saved=os.stat(parts[-1],dir_fd=parent_fd,follow_symlinks=False)
    print(json.dumps({"revision":os.environ["RIFT_NEXT_REVISION"],"size":saved.st_size,"modifiedAt":iso_time(saved.st_mtime)},separators=(",",":")))
except FileNotFoundError:
    sys.exit(44)
except OSError as error:
    if error.errno in (errno.ELOOP,errno.ENOTDIR):
        sys.exit(41)
    raise
finally:
    for fd in (temp_fd,lock_fd,tmp_fd,locks_fd,state_fd,target_fd,parent_fd):
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass'`;
