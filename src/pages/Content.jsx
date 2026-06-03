async function handleApprove() {
    setApproving(true)

    const { data, error } = await supabase.from('clients').update({
      approval_status: 'approved'
    }).eq('id', client.id).select()

    console.log('Approve result:', data, error, 'client id:', client.id)

    await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'approved',
        clientName: client.name,
        month: approvalMonth
      })
    })

    setApproving(false)
    window.location.reload()
  }

    await supabase.from('clients').update({
      approval_status: 'approved'
    }).eq('id', client.id)

    await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'approved',
        clientName: client.name,
        month: approvalMonth
      })
    })

    setApproving(false)
    window.location.reload()
  }
