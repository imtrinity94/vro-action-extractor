
import AdmZip from 'adm-zip';
const zip = new AdmZip('com.vmware.mcoe.absa.actions-0.0.2.package');
const entries = zip.getEntries();
console.log('Total entries:', entries.length);
let dataCount = 0;
entries.forEach(entry => {
    if (entry.entryName.endsWith('/data')) {
        console.log('Data entry:', entry.entryName);
        dataCount++;
    }
});
console.log('Total data entries:', dataCount);
