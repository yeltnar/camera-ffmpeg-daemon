const spawn = require('child_process').spawn;
const config = require('config');

let timeout_count=0;

let customLog;

(()=>{
	if(/nolog/.test(process.argv[2])){
		customLog = ()=>{};
	}else{
		customLog = function (...a){
			console.log(...a);
		};
	}
})();

function setupRecording( {input, out_dir, out_file, segment_time} ){

	segment_time = segment_time || `00:05:00`;

	
	const restart_delay = 5000;
	const disconnect_start_delay = 10000;

	function startRecording(){

		let ffmpeg_process = null; 
		let restart_timeout = null;
		let killed = false;

		ffmpeg_process = spawn('ffmpeg',[
			// `-loglevel`, `verbose`,
			`-i`, input,
			`-c`, `copy`,
			`-map`, `0`,
			`-segment_time`, segment_time,
			`-f`, `segment`,
			`-strftime`, `1`,
			`${out_dir}/${out_file}`
		]);
	
		// all ffmpeg logs go to stderror to allow for stdout to be piped to another process
		ffmpeg_process.stderr.on('data', function (data) {
			const s = data.toString();

			customLog(s);

			// TODO check if frame log, maybe take action on other events too 
			if( /frame/.test(s) ){
				kickTheCan();
			}
		});
	
		ffmpeg_process.on('exit', function (code) {
			if( code !== null && code !== undefined ){
				customLog('child process exited with code ' + code.toString());
			}else{
				customLog('child process exited. Code is either undefined or null');
			}
			killed=true;
		});

		function kickTheCan(){

			customLog(`kickTheCan ${out_file}` );

			if( restart_timeout !== null ){
				clearInterval(restart_timeout);
			}

			restart_timeout = setTimeout(async()=>{
				customLog(`\n\n\n---------- NO UPDATE; RESTARTING RECORDING ${out_file} ----------\n\n\n`);
				customLog(`${timeout_count}`);

				let kill_try_count = 0;

				while( killed===false && kill_try_count < 10 ){
					killed = ffmpeg_process.kill('SIGKILL');
					customLog(`Tried to stop process.... ${killed ? "worked" : "didn't work"}`);

					if( restart_timeout.killed ){
						killed = true;
					}

					kill_try_count++;
					await timeoutPromise(500);
				}

				if(killed){
					startRecording();
				}else{
					throw new Error('Could not close old process... not sure how to continue');
				}

			},restart_delay);
		}

		kickTheCan();
	}

	startRecording();


};

(()=>{

	Object.keys(config).forEach((i)=>{
		setupRecording( {
			input: config[i].input,
			out_dir: config[i].out_dir,
			out_file: config[i].out_file,
			segment_time: config[i].segment_time
		});	
	});

})();

function timeoutPromise(ms){
	return new Promise((resolve, reject)=>{
	  setTimeout(resolve,ms);
	}); 
  }
  