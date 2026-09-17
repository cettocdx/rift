# Overlap independent admission ownership reads

The authenticated admission snapshot read the chat and run-claim indexes
serially. Both use the same validated chat ID and neither depends on the other.
They now start together, retaining the two-row ambiguity bound and awaiting
both before duplicate/owner validation or any mutation. The same transaction
read set still protects claim insertion and replacement.

A controlled pending chat read reproduced the unnecessary sequencing before
the change. It now observes both reads before resolving either. The focused
claim, admission and remote-cleanup suites also verify existing ownership,
duplicate, fencing and successor behavior.

This removes one internal sequential read dependency; it is not evidence that
the entire previously observed 781 ms HTTP snapshot duration is eliminated.
Network, query execution and machine scheduling still require live measurement.
