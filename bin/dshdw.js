#!/usr/bin/env node
// dshdw 入口：只把 process.argv 交给 lib/cli.js，不在薄壳里做任何领域逻辑。
import { main } from '../lib/cli.js'

main()
