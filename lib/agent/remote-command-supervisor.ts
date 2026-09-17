/** Linux-only E2B supervisor. It outlives the worker and owns orphaned children.
 * A terminal SDK stream alone is not descendant cleanup evidence. */
export const REMOTE_COMMAND_SUPERVISOR = `import base64,json,os,sys,fcntl,signal,subprocess,time,ctypes
p=json.loads(base64.b64decode(sys.argv[1]))
if ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)!=0:
 raise OSError(ctypes.get_errno(),'Cannot enable child subreaper')
os.makedirs(p['directory'],mode=0o700,exist_ok=True)
pid=os.getpid()
boot=open('/proc/sys/kernel/random/boot_id').read().strip()
def stat(target):
 try:
  fields=open('/proc/'+str(target)+'/stat').read().rsplit(')',1)[1].split()
  return (int(fields[1]),fields[19])
 except FileNotFoundError: return None
identity='supervised-v1:'+boot+':'+stat(pid)[1]+':'+p['resourceId']
receipt={'resourceId':p['resourceId'],'pid':pid,'processIdentity':identity,'state':'started','descendantsReaped':False}
def save():
 temp=p['receipt']+'.tmp'
 with open(temp,'w') as f:
  json.dump(receipt,f);f.flush();os.fsync(f.fileno())
 os.replace(temp,p['receipt'])
stopping=False
def request_stop(signum,frame):
 global stopping
 stopping=True
signal.signal(signal.SIGTERM,request_stop)
signal.signal(signal.SIGINT,request_stop)
signal.signal(signal.SIGHUP,request_stop)
with open(p['directory']+'/launch.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 denied=os.path.exists(p['directory']+'/sealed')
 receipt['denied']=denied
 save()
 if denied:
  receipt.update(state='exited',descendantsReaped=True,exitCode=125);save();sys.exit(125)
 env=dict(os.environ);env['RIFT_RESOURCE_ID']=p['resourceId']
 child=subprocess.Popen(['/bin/bash','-c',p['command']],env=env,start_new_session=True)
# PIDFD signals plus a post-open identity check avoid signalling a reused PID.
def signal_exact(target,ticks,sig):
 try: fd=os.pidfd_open(target)
 except ProcessLookupError: return
 try:
  current=stat(target)
  if current is not None and current[1]==ticks:
   try: signal.pidfd_send_signal(fd,sig)
   except ProcessLookupError: pass
 finally: os.close(fd)
def descendants():
 allp={}
 for item in os.listdir('/proc'):
  if item.isdigit():
   current=stat(int(item))
   if current is not None: allp[int(item)]=current
 owned=set([pid]);found={};changed=True
 while changed:
  changed=False
  for target,(parent,ticks) in allp.items():
   if target not in owned and parent in owned:
    owned.add(target);found[target]=ticks;changed=True
 return found
main_status=None
cancelled=False
timed_out=False
deadline=time.monotonic()+p['budgetMs']/1000
while True:
 no_children=False
 while True:
  try: done,status=os.waitpid(-1,os.WNOHANG)
  except ChildProcessError: no_children=True;break
  if done==0: break
  if done==child.pid: main_status=os.waitstatus_to_exitcode(status)
 if no_children: break
 if time.monotonic()>=deadline: timed_out=True
 if timed_out or stopping or os.path.exists(p['directory']+'/sealed'): cancelled=True
 if cancelled or main_status is not None:
  # Freeze the observed tree before killing it. Repeated passes collect forks
  # and detached children which the subreaper adopts; ECHILD is the proof.
  owned=descendants()
  for target,ticks in owned.items(): signal_exact(target,ticks,signal.SIGSTOP)
  for target,ticks in descendants().items(): signal_exact(target,ticks,signal.SIGKILL)
 time.sleep(0.02)
code=124 if timed_out else (130 if cancelled else (main_status if main_status is not None else 125))
if code<0: code=128-code
receipt.update(state='exited',descendantsReaped=True,exitCode=code)
save()
sys.exit(code)
`;

/** Sealing and signalling are idempotent, but never grant an exit receipt.
 * The caller must independently read the supervisor's final ECHILD receipt. */
export const REMOTE_COMMAND_STOP = `import base64,json,os,sys,fcntl,signal
p=json.loads(base64.b64decode(sys.argv[1]))
os.makedirs(p['directory'],mode=0o700,exist_ok=True)
with open(p['directory']+'/launch.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 with open(p['directory']+'/sealed','a') as sealed: sealed.flush();os.fsync(sealed.fileno())
 with open(p['receipt']) as f: receipt=json.load(f)
 if receipt['resourceId']!=p['resourceId'] or receipt['pid']!=p['pid'] or receipt['processIdentity']!=p['processIdentity']: raise RuntimeError('Receipt identity mismatch')
 if not receipt['processIdentity'].startswith('supervised-v1:'): raise RuntimeError('Unsupported supervisor')
 if receipt.get('state')=='exited' and receipt.get('descendantsReaped') is True: sys.exit(0)
 def exited():
  with open(p['receipt']) as f: latest=json.load(f)
  return latest.get('processIdentity')==p['processIdentity'] and latest.get('state')=='exited' and latest.get('descendantsReaped') is True
 try: fd=os.pidfd_open(p['pid'])
 except ProcessLookupError:
  if exited(): sys.exit(0)
  raise RuntimeError('Supervisor absent without exit proof')
 try:
  try:
   ticks=open('/proc/'+str(p['pid'])+'/stat').read().rsplit(')',1)[1].split()[19]
   boot=open('/proc/sys/kernel/random/boot_id').read().strip()
  except FileNotFoundError:
   if exited(): sys.exit(0)
   raise RuntimeError('Supervisor absent without exit proof')
  expected='supervised-v1:'+boot+':'+ticks+':'+p['resourceId']
  if expected!=p['processIdentity']: raise RuntimeError('Supervisor PID was reused')
  try: signal.pidfd_send_signal(fd,signal.SIGTERM)
  except ProcessLookupError:
   if not exited(): raise RuntimeError('Supervisor absent without exit proof')
 finally: os.close(fd)
`;
