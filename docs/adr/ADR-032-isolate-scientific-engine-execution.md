# ADR-032: Isolate scientific engine execution

Status: Accepted

Native scientific engines execute outside FastAPI in bounded subprocess environments. The adapter uses fixed argv, server-controlled paths/resources, isolated working directories, bounded output, and immutable artifact capture. This reduces native-library, memory, crash, and future container-migration risk.
