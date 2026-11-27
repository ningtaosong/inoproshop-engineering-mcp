// Independent read-only diagnostic. No OEM or engineering entry points.
using System;
using System.IO;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class ResidentFileIdentity {
  [StructLayout(LayoutKind.Sequential)] struct Info {
    public uint attributes,creationLow,creationHigh,accessLow,accessHigh,writeLow,writeHigh;
    public uint volume,sizeHigh,sizeLow,links,indexHigh,indexLow;
  }
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info i);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder s,uint n,uint flags);
  public static string[] Read(string path) {
    using(var f=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)) {
      Info i;if(!GetFileInformationByHandle(f.SafeFileHandle,out i))throw new Win32Exception();
      var s=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(f.SafeFileHandle,s,(uint)s.Capacity,0);
      if(n==0||n>=s.Capacity)throw new Win32Exception();
      string p=s.ToString();if(p.StartsWith(@"\\?\UNC\"))p=@"\\"+p.Substring(8);else if(p.StartsWith(@"\\?\"))p=p.Substring(4);
      ulong ino=((ulong)i.indexHigh<<32)|i.indexLow;if(ino==0)throw new IOException("File identity unavailable");
      using(var hash=System.Security.Cryptography.SHA256.Create())return new[]{p,i.volume.ToString()+":"+ino.ToString(),BitConverter.ToString(hash.ComputeHash(f)).Replace("-","").ToLowerInvariant()};
    }
  }
}
